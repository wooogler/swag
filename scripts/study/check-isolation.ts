/**
 * Isolation check: the study machinery must be invisible to ordinary SWAG use.
 *
 * The one change that reaches platform users is internal: resolveAgainstSnapshot
 * (behind resolveDeployedChatPrompt, which /api/chat calls for EVERY assignment
 * with a SCORE deploy, study or not) now returns a discriminated outcome. Its
 * observable behaviour must be unchanged — same prompt, same applied record,
 * same fail-open to the base prompt.
 *
 * Also asserts the study tables carry nothing for a non-study assignment.
 *
 *   npx tsx --env-file=.env scripts/study/check-isolation.ts
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  assignments,
  instructors,
  scoreChatDeploys,
  scoreIntents,
  studyClones,
} from '../../src/db/schema';

async function main() {
  const { resolveDeployedChatPrompt, buildChatDeploySnapshot, recordChatDeploy } = await import(
    '../../src/lib/score/deploy-store'
  );
  const { ensureTypeRoots, ensureIntentTables } = await import('../../src/lib/score/intent-store');
  const { assignmentBasePrompt } = await import('../../src/lib/assignment-ai');
  await ensureIntentTables();

  // A throwaway ORDINARY assignment: no study clone row, no participant.
  const [owner] = await db.select().from(instructors).where(eq(instructors.role, 'administrator')).limit(1);
  if (!owner) throw new Error('need an administrator to own the scratch assignment');

  const id = randomUUID();
  const shareToken = `isolation-check-${id.slice(0, 8)}`;
  await db.insert(assignments).values({
    id,
    title: 'Isolation check (temporary)',
    instructions: 'Write a short argument.',
    deadline: new Date(Date.now() + 86_400_000),
    shareToken,
    instructorId: owner.id,
    customSystemPrompt: 'You are a supportive writing coach.',
    includeInstructionInPrompt: false,
    createdAt: new Date(),
  });
  const assignment = (await db.query.assignments.findFirst({ where: eq(assignments.id, id) }))!;
  const basePrompt = assignmentBasePrompt(assignment);
  console.log(`scratch assignment ${id.slice(0, 8)}… (NOT a study clone)\n`);

  try {
    const isClone = await db.select().from(studyClones).where(eq(studyClones.assignmentId, id));
    console.log(`1. registered as a study clone: ${isClone.length > 0} (expect false)${isClone.length === 0 ? ' ✓' : ' ✗'}`);

    // ── no deploy → base prompt, exactly as before ──────────────────────
    const before = await resolveDeployedChatPrompt({
      assignmentId: id,
      basePrompt,
      queryText: 'Can you write my intro?',
      prevQueryText: null,
      prevResponseText: null,
    });
    console.log(
      `2. no deploy → basePrompt=${before.systemPrompt === basePrompt} applied=${before.applied} version=${before.deployVersion}${
        before.systemPrompt === basePrompt && before.applied === null ? ' ✓' : ' ✗'
      }`
    );

    // ── with a deploy → routes, and reports the version ─────────────────
    await ensureTypeRoots(id);
    const now = new Date();
    await db.insert(scoreIntents).values({
      assignmentId: id,
      title: 'ISOLATION: ghostwriting',
      definition: 'The student asks the chatbot to write prose for them.',
      rule: 'Do not write it. Ask one question that helps them write it themselves.',
      kind: 'intent',
      type: 'drafting',
      isTemplate: false,
      createdAt: now,
      updatedAt: now,
    });
    const snapshot = await buildChatDeploySnapshot(id);
    const versionNo = await recordChatDeploy(id, null, snapshot, 'isolation-check');

    const after = await resolveDeployedChatPrompt({
      assignmentId: id,
      basePrompt,
      queryText: 'Can you write my intro paragraph for me?',
      prevQueryText: null,
      prevResponseText: null,
    });
    const routed = after.applied !== null && after.systemPrompt !== basePrompt;
    console.log(
      `3. deployed v${versionNo} → applied=${after.applied?.intentTitle ?? 'none'}/${after.applied?.outcome ?? '-'} version=${after.deployVersion}${routed ? ' ✓' : ' ✗ (fell back to base prompt)'}`
    );
    console.log(`   injected prompt: "${after.systemPrompt.slice(0, 70)}…"`);

    // ── study tables hold nothing for it ────────────────────────────────
    const counts = await db.execute<{ table_name: string; n: number }>(sql`
      SELECT 'study_events' AS table_name, count(*)::int AS n FROM study_events WHERE assignment_id = ${id}
      UNION ALL SELECT 'study_generated_responses', count(*)::int FROM study_generated_responses WHERE clone_assignment_id = ${id}
      UNION ALL SELECT 'study_test_answers', count(*)::int FROM study_test_answers WHERE clone_assignment_id = ${id}
      UNION ALL SELECT 'baseline_prompt_versions', count(*)::int FROM baseline_prompt_versions WHERE assignment_id = ${id}
    `);
    const dirty = counts.filter((r) => r.n > 0);
    console.log(
      `4. study tables referencing it: ${dirty.length === 0 ? 'none ✓' : dirty.map((d) => `${d.table_name}=${d.n}`).join(', ') + ' ✗'}`
    );
  } finally {
    await db.delete(scoreChatDeploys).where(eq(scoreChatDeploys.assignmentId, id));
    await db.delete(scoreIntents).where(eq(scoreIntents.assignmentId, id));
    await db.delete(assignments).where(eq(assignments.id, id));
    console.log('\nscratch assignment removed.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
