/**
 * The participant moves themselves through the protocol.
 *
 * The session is watched over a shared screen rather than gated, so what a
 * facilitator used to do by hand at each hand-off has to happen here instead —
 * and that is not merely a phase bump. A block test and the blind A/B show
 * FROZEN answers, which exist only once something generates them, so the two
 * hand-offs that lead into a measurement await a generation batch before the
 * phase moves at all. A participant who lands on "Not ready yet" has been let
 * through a door that should not have opened.
 *
 * Forward only, one step at a time, and never past a missing deploy. `force`,
 * `back` and arbitrary jumps stay in the console, where a facilitator can see
 * what they are overriding.
 */
import { STUDY_DATASETS } from './config';
import { deployStateFor, setParticipantPhase } from './console-store';
import { logParticipantEvent } from './events';
import { generateForClone, type BankKind } from './generate';
import { cloneForBlock } from './measure-store';
import { isStudyPhase, nextPhase, type StudyPhase } from './phases';
import { warmInFlight } from './warm';
import type { StudyParticipant } from '@/db/schema';

/**
 * What has to be frozen on the way OUT of a phase.
 *
 * The A/B halves are split rather than done together: block 1's configuration
 * is final once its survey is in, so its answers are made on the way into the
 * break, leaving only block 2's in front of the study's primary measure
 * (generate.ts §5).
 */
const PREP_ON_LEAVING: Partial<Record<StudyPhase, { kind: BankKind; block: 1 | 2 }>> = {
  block1_work: { kind: 'test', block: 1 },
  block2_work: { kind: 'test', block: 2 },
  block1_survey: { kind: 'ab', block: 1 },
  block2_survey: { kind: 'ab', block: 2 },
};

export type AdvanceRefusal =
  | 'phase_moved'
  | 'no_next'
  | 'no_clone'
  | 'not_deployed'
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

  const prep = PREP_ON_LEAVING[phase];
  if (prep) {
    const clone = await cloneForBlock(participant, prep.block);
    if (!clone) {
      return refuse(participant, phase, 'no_clone', {
        message: 'Your workspace could not be found — tell your facilitator.',
        detail: { block: prep.block },
      });
    }

    // Checked before the batch rather than caught from it: generateForClone
    // throws not_deployed after doing work, and this is the one refusal a
    // participant can act on themselves.
    const { deployed } = await deployStateFor(clone);
    if (!deployed) {
      return refuse(participant, phase, 'not_deployed', {
        message: 'Deploy your chatbot first — the next step is about the version you deployed.',
        detail: { datasetKey: clone.datasetKey },
      });
    }

    // The deploy already started this batch (warm.ts). Let it finish rather
    // than racing it: both runs would call the model for every item and write
    // over each other, and waiting is what usually makes this hand-off instant.
    await warmInFlight(clone.assignmentId);

    // Block test = this clone's own dataset. A/B = both datasets, which is how
    // one configuration comes to answer the other set's questions.
    const datasetKeys =
      prep.kind === 'test' ? [clone.datasetKey] : STUDY_DATASETS.map((d) => d.key);

    for (const datasetKey of datasetKeys) {
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
          message: 'This step has no questions loaded yet — tell your facilitator.',
          detail: { datasetKey, kind: prep.kind },
        });
      }
      // Stay put on a partial batch too. Moving on would drop the participant
      // onto a screen missing some of its questions, and a missing answer is
      // not recoverable from that side of the app.
      if (thrown !== null || failed !== 0) {
        return refuse(participant, phase, 'generation_failed', {
          message: 'Something went wrong preparing the next step — tell your facilitator.',
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
