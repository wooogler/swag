/**
 * The participant moves themselves through the protocol.
 *
 * The session is watched over a shared screen rather than gated, so what a
 * facilitator used to do by hand at each hand-off has to happen here instead —
 * and that is not merely a phase bump. A block test shows FROZEN answers, which
 * exist only once something generates them, so the hand-off that leads into one
 * awaits a generation batch before the phase moves at all. A participant who
 * lands on "Not ready yet" has been let through a door that should not have
 * opened.
 *
 * Forward only, one step at a time, and never past a missing deploy. `force`,
 * `back` and arbitrary jumps stay in the console, where a facilitator can see
 * what they are overriding.
 */
import { deployStateFor, setParticipantPhase } from './console-store';
import { logParticipantEvent } from './events';
import { generateForClone, type BankKind } from './generate';
import { cloneForBlock } from './measure-store';
import { familyOf, isStudyPhase, nextPhase, type StudyPhase } from './phases';
import { warmInFlight } from './warm';
import type { StudyParticipant } from '@/db/schema';

/**
 * Which block's clone a hand-off is ABOUT. Both hand-offs out of a block need
 * it deployed: the questionnaire asks about the round "up to when you
 * deployed", and the test reads answers that only a deployed configuration
 * can produce.
 */
const BLOCK_ON_LEAVING: Partial<Record<StudyPhase, 1 | 2>> = {
  block1_work: 1,
  block1_survey: 1,
  block2_work: 2,
  block2_survey: 2,
};

/**
 * What has to be frozen on the way OUT of a phase: each block's configuration
 * is final once the work is done, so its answers are made on the way into the
 * test that reads them.
 *
 * This is the questionnaire's exit, not the work's, and the split is the whole
 * point of putting the questionnaire there (design §5.3 ②). Deploy starts the
 * batch in the background (warm.ts); the participant then spends a minute on
 * five questions while it runs, and the wait this hand-off would otherwise
 * impose has already been spent. Keyed on `block*_work` — as it was when the
 * test came straight after — the wait would land BEFORE the questionnaire
 * instead, which is the arrangement the move was meant to undo.
 */
const PREP_ON_LEAVING: Partial<Record<StudyPhase, { kind: BankKind; block: 1 | 2 }>> = {
  block1_survey: { kind: 'test', block: 1 },
  block2_survey: { kind: 'test', block: 2 },
};

export type AdvanceRefusal =
  | 'phase_moved'
  | 'no_next'
  | 'no_clone'
  | 'not_deployed'
  | 'unsaved_changes'
  | 'bank_empty'
  | 'generation_failed';

export type AdvanceResult =
  | { ok: true; phase: StudyPhase }
  | { ok: false; reason: AdvanceRefusal; message: string; phase: StudyPhase };

export function currentPhase(participant: { phase: string | null }): StudyPhase {
  return isStudyPhase(participant.phase) ? participant.phase : 'not_started';
}

/** Whether leaving this phase will make the participant wait on generation. */
export function advanceWaits(phase: StudyPhase): boolean {
  return PREP_ON_LEAVING[phase] !== undefined;
}

export async function advanceParticipant(
  participant: StudyParticipant,
  from?: string
): Promise<AdvanceResult> {
  const phase = currentPhase(participant);

  // The console can still move someone while their own page sits open. A click
  // from a page that no longer reflects where they are is refused rather than
  // raced, and the client re-reads.
  if (from && from !== phase) {
    return {
      ok: false,
      reason: 'phase_moved',
      phase,
      message: 'This page is out of date — reloading.',
    };
  }

  const to = nextPhase(phase);
  if (!to) {
    return { ok: false, reason: 'no_next', phase, message: 'The session is already finished.' };
  }

  const block = BLOCK_ON_LEAVING[phase];
  const prep = PREP_ON_LEAVING[phase];
  if (block) {
    const clone = await cloneForBlock(participant, block);
    if (!clone) {
      return refuse(participant, phase, 'no_clone', {
        message: 'Your workspace could not be found — message the researcher on the Zoom call.',
        detail: { block },
      });
    }

    // Checked before the batch rather than caught from it: generateForClone
    // throws not_deployed after doing work, and this is the one refusal a
    // participant can act on themselves. Checked leaving the questionnaire
    // too, not only the work — the console can force a phase, and a jump past
    // the work would otherwise reach generation with nothing deployed and
    // report it as something going wrong on our side.
    // `clone.condition` from cloneForBlock is the ARM; this needs the whole
    // view, because which store holds the deployed configuration is a fact
    // about the FAMILY. Handed the arm, the simple family fell through to the
    // full version's tables, found nothing, and told every simple participant
    // that nothing had been set up.
    const { deployed, unsaved, label } = await deployStateFor({
      assignmentId: clone.assignmentId,
      condition: clone.view,
    });
    if (!deployed) {
      // Three ways of not being ready, and each one has to name the button
      // that fixes it and the state it is in. The simple board's said "save"
      // — written before it had a Deploy button, and left naming a verb that
      // is on the screen but is not the one that ends the block. A message
      // pointing at the wrong control is worse than none: it reads as
      // something having gone wrong rather than as one press being missing.
      const simple = familyOf(participant) === 'simple';
      return refuse(participant, phase, unsaved ? 'unsaved_changes' : 'not_deployed', {
        message: simple
          ? label === 'changed since deploy'
            ? 'You have changed things since you deployed. Press Deploy again — the next step is about the setup you deploy.'
            : label === 'never deployed'
              ? 'You have not deployed yet. Press Deploy — the next step is about the setup you deploy.'
              : 'Nothing has been set up here yet. Change something, then press Deploy — the next step is about the setup you deploy.'
          : unsaved
            ? 'You have changes that are not saved yet. Save them — the next step is about your saved version.'
            : 'Deploy your chatbot first — the next step is about the version you deployed.',
        detail: { datasetKey: clone.datasetKey },
      });
    }

    // Nested rather than a branch of its own: every phase that preps is also
    // one that needed the clone, so this reuses the row and the check above.
    if (prep) {
      // The deploy already started this batch (warm.ts). Let it finish rather
      // than racing it: both runs would call the model for every item and
      // write over each other, and waiting is what usually makes this hand-off
      // instant — more so now that a questionnaire ran while it worked.
      await warmInFlight(clone.assignmentId);

      // A block test is always over this clone's OWN dataset.
      const datasetKey = clone.datasetKey;
      let failed = 0;
      let thrown: string | null = null;
      try {
        ({ failed } = await generateForClone({
          cloneAssignmentId: clone.assignmentId,
          datasetKey,
          kind: prep.kind,
        }));
      } catch (error) {
        thrown = (error as Error).message;
      }

      // An unpopulated bank is a study that was not finished being set up, not
      // a run that went wrong — worth its own reason, because the fix is a
      // researcher's and the console already reports it as "no bank items".
      if (thrown === 'empty_bank') {
        return refuse(participant, phase, 'bank_empty', {
          message: 'This step has no questions loaded yet — message the researcher on the Zoom call.',
          detail: { datasetKey, kind: prep.kind },
        });
      }
      // Stay put on a partial batch too. Moving on would drop the participant
      // onto a screen missing some of its questions, and a missing answer is
      // not recoverable from that side of the app.
      if (thrown !== null || failed !== 0) {
        return refuse(participant, phase, 'generation_failed', {
          message: 'Something went wrong preparing the next step — message the researcher on the Zoom call.',
          detail: { datasetKey, kind: prep.kind, failed, thrown },
        });
      }
    }
  }

  await setParticipantPhase(participant, to, 'participant');
  return { ok: true, phase: to };
}

/**
 * Refuse, and leave a trace. A participant who cannot get past a step says so
 * out loud in a moderated session, but the reason lives on this side — and
 * afterwards it is the only record that the run stalled here.
 */
async function refuse(
  participant: StudyParticipant,
  phase: StudyPhase,
  reason: AdvanceRefusal,
  opts: { message: string; detail?: Record<string, unknown> }
): Promise<AdvanceResult> {
  await logParticipantEvent(participant.id, 'phase_advance_refused', {
    phase,
    reason,
    ...opts.detail,
  });
  return { ok: false, reason, phase, message: opts.message };
}
