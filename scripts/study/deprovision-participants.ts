/**
 * Tear down SCORE user-study participants — delete a participant's cloned
 * dataset assignments (every clone, with all sessions / messages / SCORE rows),
 * their instructor account, and the study bookkeeping rows. Use to clean up
 * after a study. To keep the account and only refresh clones from the current
 * master, use scripts/study/reset-participants.ts instead.
 *
 * SAFE BY CONSTRUCTION: only assignments registered in study_clones are ever
 * touched, so a master dataset can never be deleted through this script.
 *
 * Usage:
 *   tsx scripts/study/deprovision-participants.ts --number P01 [--yes]
 *   tsx scripts/study/deprovision-participants.ts --all [--yes]
 *
 * Without --yes it lists what WOULD be deleted (dry run) and exits.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { studyClones, studyParticipants, type StudyParticipant } from '../../src/db/schema';
import { ensureStudyTables, normalizeParticipantNumber } from '../../src/lib/study/store';
import { deleteParticipant } from '../../src/lib/study/teardown';

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
  console.error(`${confirmed ? 'Deleting' : 'Would delete'} ${targets.length} participant(s):`);
  for (const p of targets) {
    const n = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(studyClones)
      .where(eq(studyClones.participantId, p.id));
    console.error(`  ${p.participantNumber}  instructor=${p.instructorId}  clones=${n[0]?.c ?? 0}`);
  }
  if (!confirmed) {
    console.error('\nDry run. Re-run with --yes to actually delete.');
    process.exit(0);
  }

  let ok = 0;
  for (const p of targets) {
    try {
      const n = await deleteParticipant(p);
      ok++;
      console.error(`  ${p.participantNumber}: deleted (${n} clone(s))`);
    } catch (err) {
      console.error(`  ${p.participantNumber}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.error(`\nDone. deleted=${ok}/${targets.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
