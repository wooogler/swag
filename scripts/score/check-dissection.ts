/**
 * One-off: run the DETERMINISTIC dissector over the sampled NIRVANA queries and
 * report which come back with zero requests (the signal Fix A would gate on).
 * Cross-references the stability audit's decision-flip cells.
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

const NIRVANA = 'ea905a40-ad5d-4fe5-bbf8-91d6b1998331';
const DATA = JSON.parse(
  readFileSync(
    '/tmp/claude-1000/-home-sangwonlee-swag/4bc76ef4-451a-47e0-8dc8-f22177ab5d76/scratchpad/artifact-data.json',
    'utf8'
  )
);

async function main() {
  const { computeDissections } = await import('@/lib/score/dissect');
  const ids: number[] = DATA.queries.map((q: any) => q.messageId);
  const flipsByMsg = new Map<number, string[]>();
  for (const f of DATA.flips) {
    const a = flipsByMsg.get(f.messageId) ?? [];
    a.push(f.code);
    flipsByMsg.set(f.messageId, a);
  }
  const diss = await computeDissections(NIRVANA, new Set(ids));
  let emptyCount = 0;
  for (const q of DATA.queries) {
    const d = diss.get(q.messageId);
    const nReq = d ? d.requests.length : -1;
    const empty = nReq === 0;
    if (empty) emptyCount++;
    const flips = flipsByMsg.get(q.messageId) ?? [];
    console.log(
      `#${q.messageId} ${empty ? 'EMPTY-REQ ⚑' : nReq + ' req'}  mat=[${d?.materialKinds.join(',') || ''}]  ` +
        `flips=${flips.length}${flips.length ? ' (' + flips.join(',') + ')' : ''}  | "${q.preview.slice(0, 60)}"`
    );
  }
  console.log(`\n${emptyCount}/${DATA.queries.length} queries have ZERO requests (Fix A would force Base-only fallback on these).`);
  // How many of the 28 flips sit on empty-request messages?
  let flipsOnEmpty = 0;
  for (const f of DATA.flips) {
    const d = diss.get(f.messageId);
    if (d && d.requests.length === 0) flipsOnEmpty++;
  }
  console.log(`${flipsOnEmpty}/${DATA.flips.length} decision-flip cells are on zero-request messages → deterministically removed by Fix A.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
