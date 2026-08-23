/**
 * Recompute the deterministic Material/Request dissection for whole assignments
 * and write it back at the current DISSECTION_VERSION.
 *
 * The rate route only re-dissects messages it is already rating or typing, so a
 * DISSECTION_VERSION bump reaches a board with no pending rating work only when
 * someone runs a full rate pass. This script does that one job on its own, with
 * no LLM calls (dissection is reconstructed from the editor-event log).
 *
 * Study CLONES are handled the other way round: they carry the master's message
 * log and cached dissections but NOT its editor events, so recomputing there
 * would find no pasted material at all. For a clone this script COPIES the
 * master's rows across, matching messages on the natural key provisioning
 * preserved — (participant token, conversation, sequence number).
 *
 *   npx tsx scripts/score/redissect.ts --all
 *   npx tsx scripts/score/redissect.ts <assignmentId> [<assignmentId> …]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
(function () {
  try {
    const t = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const l of t.split('\n')) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
})();

async function main() {
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/db/db');
  const { assignments, scoreDissections, scoreQueryEmbeddings, studyClones } = await import(
    '@/db/schema'
  );
  const { computeDissections, hasEditorEventLog } = await import('@/lib/score/dissect');
  const { getQueryRecords } = await import('@/lib/score/queries');
  const { DISSECTION_VERSION } = await import('@/lib/score/intents');
  const { ensureIntentTables } = await import('@/lib/score/intent-store');
  const { CURATION_DATASETS, studyMasterToken } = await import('@/lib/study/config');
  const { ensureStudyTables } = await import('@/lib/study/store');

  await Promise.all([ensureIntentTables(), ensureStudyTables()]);

  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const requested = all
    ? (await db.select({ id: assignments.id }).from(assignments)).map((a) => a.id)
    : argv;
  if (requested.length === 0) {
    console.error('usage: redissect.ts --all | <assignmentId> …');
    process.exit(1);
  }

  const cloneRows = await db
    .select({ assignmentId: studyClones.assignmentId, sourceId: studyClones.sourceAssignmentId })
    .from(studyClones);
  const sourceOf = new Map(cloneRows.map((c) => [c.assignmentId, c.sourceId]));
  // A study MASTER is a copy too, and the copy it came from is the only place
  // its dissections can be recomputed: build.ts makes it from the curation
  // dataset with includeEditorEvents: false, and nothing records the link in
  // study_clones (it is the source of clones, not one). Without this it is
  // skipped as "no editor-event log and not a known clone" — and every clone
  // then copies its stale rows forward, which is exactly what a version bump
  // must not leave behind. Registered BEFORE the sort below so the ordering
  // (masters first) puts the chain in the right order: dataset → study master
  // → participant clone.
  for (const dataset of CURATION_DATASETS) {
    const [studyMaster] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(eq(assignments.shareToken, studyMasterToken(dataset.key)));
    if (studyMaster) sourceOf.set(studyMaster.id, dataset.masterAssignmentId);
  }
  // Upstream first: a copy takes whatever its source holds, so the source must
  // already be at the current version when the copy runs. The chain is three
  // deep (dataset master → study master → participant clone), so this is a
  // distance-from-the-root sort, not a copy/not-a-copy one.
  const depthOf = (id: string): number => {
    let depth = 0;
    let cursor = sourceOf.get(id);
    while (cursor && depth < 8) {
      depth += 1;
      cursor = sourceOf.get(cursor);
    }
    return depth;
  };
  const ids = [...requested].sort((a, b) => depthOf(a) - depthOf(b));

  /** Copy a master's dissections onto a clone. The natural key is exactly the
   * one provision.ts built its temp maps from, so the match is 1:1; a shortfall
   * means the clone diverged and is reported rather than half-applied. */
  async function copyFromMaster(cloneId: string, masterId: string): Promise<void> {
    const copied = await db.execute<{ n: number }>(sql`
      WITH pairs AS (
        SELECT nm.id AS new_msg, om.id AS old_msg
        FROM student_sessions ns
        JOIN student_sessions os
          ON os.assignment_id = ${masterId} AND os.participant_token = ns.participant_token
        JOIN chat_conversations nc ON nc.session_id = ns.id
        JOIN chat_conversations oc
          ON oc.session_id = os.id AND oc.created_at = nc.created_at
         AND oc.title IS NOT DISTINCT FROM nc.title
        JOIN chat_messages nm ON nm.conversation_id = nc.id AND nm.role = 'user'
        JOIN chat_messages om
          ON om.conversation_id = oc.id AND om.sequence_number = nm.sequence_number
        WHERE ns.assignment_id = ${cloneId}
      ), ins AS (
        INSERT INTO score_dissections
          (assignment_id, message_id, material_kinds, requests, materials, version,
           raw_response, model, created_at)
        SELECT ${cloneId}, p.new_msg, d.material_kinds, d.requests, d.materials, d.version,
               d.raw_response, d.model, now()
        FROM pairs p
        JOIN score_dissections d ON d.message_id = p.old_msg AND d.assignment_id = ${masterId}
        ON CONFLICT (message_id) DO UPDATE SET
          material_kinds = EXCLUDED.material_kinds,
          requests       = EXCLUDED.requests,
          materials      = EXCLUDED.materials,
          version        = EXCLUDED.version,
          model          = EXCLUDED.model,
          created_at     = EXCLUDED.created_at
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM ins
    `);
    const n = copied[0]?.n ?? 0;
    const records = await getQueryRecords(cloneId);
    // Same invalidation the master branch performs. The embed cache tag now
    // carries DISSECTION_VERSION, so a stale vector can no longer be READ —
    // this only stops the table keeping a copy of every generation forever.
    await db
      .delete(scoreQueryEmbeddings)
      .where(eq(scoreQueryEmbeddings.assignmentId, cloneId));
    const short = records.length - n;
    console.log(
      `${cloneId}: clone of ${masterId} — copied ${n}/${records.length} dissections` +
        (short > 0 ? `  ⚠ ${short} unmatched` : '')
    );
  }

  for (const assignmentId of ids) {
    const master = sourceOf.get(assignmentId);
    if (master) {
      await copyFromMaster(assignmentId, master);
      continue;
    }
    if (!(await hasEditorEventLog(assignmentId))) {
      console.log(`${assignmentId}: no editor-event log and not a known clone — skipped`);
      continue;
    }
    const records = await getQueryRecords(assignmentId);
    if (records.length === 0) {
      console.log(`${assignmentId}: no student messages — skipped`);
      continue;
    }
    const dissections = await computeDissections(
      assignmentId,
      new Set(records.map((r) => r.messageId))
    );
    const now = new Date();
    const counts: Record<string, number> = {};
    for (const [messageId, d] of dissections) {
      for (const m of d.materials ?? []) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
      const values = {
        materialKinds: d.materialKinds,
        requests: d.requests,
        materials: d.materials ?? [],
        version: DISSECTION_VERSION,
        rawResponse: null,
        model: 'deterministic',
        createdAt: now,
      };
      await db
        .insert(scoreDissections)
        .values({ assignmentId, messageId, ...values })
        .onConflictDoUpdate({ target: scoreDissections.messageId, set: values });
    }
    // Embeddings are computed on the dissected text — drop them so they rebuild
    // against the fresh split (the same invalidation the rate route performs).
    if (dissections.size > 0) {
      await db
        .delete(scoreQueryEmbeddings)
        .where(
          and(
            eq(scoreQueryEmbeddings.assignmentId, assignmentId),
            inArray(scoreQueryEmbeddings.messageId, [...dissections.keys()])
          )
        );
    }
    const runs = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(' ');
    console.log(`${assignmentId}: ${dissections.size} messages → v${DISSECTION_VERSION}  ${runs}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
