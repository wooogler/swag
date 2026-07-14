/**
 * Reset SCORE study participants to the CURRENT master(s).
 *
 * For each target: delete their existing dataset clones (their SCORE work is
 * discarded) but KEEP the account, then re-clone every configured dataset from
 * the master as it stands now. Use after you edit a master's starter set and
 * re-run "Run all" on it, to push the updated starter set to participants who
 * already have clones. (New participants get the latest master automatically on
 * first sign-in — they never need a reset.)
 *
 * The participant number + passcode stay valid; the next sign-in shows the
 * refreshed boards.
 *
 * Usage:
 *   tsx scripts/study/reset-participants.ts --number P01 [--yes]
 *   tsx scripts/study/reset-participants.ts --all [--yes]
 *
 * Without --yes it lists what WOULD be reset (dry run) and exits.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { studyClones, studyParticipants, type StudyParticipant } from '../../src/db/schema';
import { ensureStudyTables, normalizeParticipantNumber } from '../../src/lib/study/store';
import { resetParticipant } from '../../src/lib/study/provision';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

async function resolveTargets(args: Record<string, string | boolean>): Promise<StudyParticipant[]> {
  if (typeof args.number === 'string') {
    const number = normalizeParticipantNumber(args.number);
    const p = await db.query.studyParticipants.findFirst({
      where: eq(studyParticipants.participantNumber, number),
    });
    if (!p) {
      console.error(`No participant found: ${number}`);
      process.exit(1);
    }
    return [p];
  }
  if (args.all === true) {
    return db.select().from(studyParticipants);
  }
  console.error('Usage:\n  --number <P01> [--yes]\n  --all [--yes]');
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureStudyTables();

  const targets = await resolveTargets(args);
  if (targets.length === 0) {
    console.error('No matching participants.');
    process.exit(0);
  }

  const confirmed = args.yes === true;
  console.error(
    `${confirmed ? 'Resetting' : 'Would reset'} ${targets.length} participant(s) to the current master(s):`
  );
  for (const p of targets) {
    const n = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(studyClones)
      .where(eq(studyClones.participantId, p.id));
    console.error(`  ${p.participantNumber}  instructor=${p.instructorId}  current clones=${n[0]?.c ?? 0} (will be discarded + re-cloned)`);
  }
  if (!confirmed) {
    console.error('\nDry run. Re-run with --yes to actually reset (discards participant SCORE work).');
    process.exit(0);
  }

  let ok = 0;
  for (const p of targets) {
    try {
      const { clones } = await resetParticipant(p);
      ok++;
      console.error(`  ${p.participantNumber}: reset (${clones.length} clone(s) re-created)`);
    } catch (err) {
      console.error(`  ${p.participantNumber}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.error(`\nDone. reset=${ok}/${targets.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
