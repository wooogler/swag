/**
 * DRY RUN for the v6 seam-orphan guard: recompute the dissection from the
 * editor-event log and report every message whose REQUESTS change, without
 * writing anything.
 *
 * The guard drops a run's leftover last clause instead of reporting it as a
 * typed request (dissect.ts, isSeamOrphan). What it must not do is eat a real
 * short ask, so this prints both directions of the diff and lets a human read
 * the list before redissect.ts writes it.
 *
 *   npx tsx --env-file=.env scripts/score/check-seam-orphans.ts --all
 *   npx tsx --env-file=.env scripts/score/check-seam-orphans.ts <assignmentId> …
 */
export {};

async function main() {
  const { eq, inArray } = await import('drizzle-orm');
  const { db } = await import('../../src/db/db');
  const { assignments, scoreDissections } = await import('../../src/db/schema');
  const { computeDissections, hasEditorEventLog } = await import('../../src/lib/score/dissect');
  const { getQueryRecords } = await import('../../src/lib/score/queries');

  const argv = process.argv.slice(2);
  const ids = argv.includes('--all')
    ? (await db.select({ id: assignments.id }).from(assignments)).map((a) => a.id)
    : argv;
  if (ids.length === 0) {
    console.error('usage: check-seam-orphans.ts --all | <assignmentId> …');
    process.exit(1);
  }

  let totalDropped = 0, totalAdded = 0, totalChanged = 0, totalNowEmpty = 0, scanned = 0;
  for (const assignmentId of ids) {
    if (!(await hasEditorEventLog(assignmentId))) continue;
    const records = await getQueryRecords(assignmentId);
    if (records.length === 0) continue;
    const fresh = await computeDissections(assignmentId, new Set(records.map((r) => r.messageId)));
    const stored = new Map(
      (await db.select().from(scoreDissections).where(
        inArray(scoreDissections.messageId, [...fresh.keys()])
      )).map((d) => [d.messageId, (d.requests as string[]) ?? []])
    );
    scanned += fresh.size;
    for (const [messageId, d] of fresh) {
      const before = stored.get(messageId);
      if (!before) continue;
      const after = d.requests;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      totalChanged++;
      const dropped = before.filter((r) => !after.includes(r));
      const added = after.filter((r) => !before.includes(r));
      totalDropped += dropped.length;
      totalAdded += added.length;
      if (before.length > 0 && after.length === 0) totalNowEmpty++;
      console.log(
        `${assignmentId.slice(0, 8)} msg ${messageId}` +
          (dropped.length ? `\n   − ${dropped.map((r) => JSON.stringify(r)).join('  ')}` : '') +
          (added.length ? `\n   + ${added.map((r) => JSON.stringify(r)).join('  ')}` : '')
      );
    }
  }
  console.log(
    `\nscanned ${scanned} messages · ${totalChanged} changed · ${totalDropped} request(s) dropped · ${totalAdded} added · ${totalNowEmpty} message(s) now report no request`
  );
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
