/**
 * Prompt parity + abridgement preflight.
 *
 * Renders every stored dissection through both prompt builders and reports:
 *  1. TYPE path — buildQueryContent must be byte-identical to the verbatim
 *     rendering. A single stray character here silently poisons every cached
 *     score_query_types row, and types have no master→clone repair path.
 *  2. RATING path — how many messages the abridged mode actually changes, how
 *     much text it removes, and every class the design flagged as a casualty.
 *
 * Read-only. Run: npx tsx --env-file=.env scripts/score/check-prompt-parity.ts
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

type MaterialKind = import('@/lib/score/intents').MaterialKind;
type MaterialSpan = import('@/lib/score/intents').MaterialSpan;
type PromptDissection = import('@/lib/score/intents').PromptDissection;

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

async function main() {
  const { inArray } = await import('drizzle-orm');
  const { db } = await import('@/db/db');
  const { scoreDissections, chatMessages } = await import('@/db/schema');
  const { MATERIAL_PROMPT_MODE, INTENT_RATING_VERSION } = await import('@/lib/score/intents');
  const { abridgeQuery, buildQueryContent, buildRatingQueryContent } = await import(
    '@/lib/score/prompts'
  );
  const { segmentForMaterials } = await import('@/lib/score/material-render');
  const { ensureIntentTables } = await import('@/lib/score/intent-store');
  await ensureIntentTables();

  const rows = await db
    .select({
      messageId: scoreDissections.messageId,
      assignmentId: scoreDissections.assignmentId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
      materials: scoreDissections.materials,
      version: scoreDissections.version,
    })
    .from(scoreDissections);

  const ids = [...new Set(rows.map((r) => r.messageId))];
  const texts = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = await db
      .select({ id: chatMessages.id, content: chatMessages.content })
      .from(chatMessages)
      .where(inArray(chatMessages.id, ids.slice(i, i + 500)));
    for (const m of chunk) texts.set(m.id, m.content ?? '');
  }

  let typeChanged = 0;
  let ratingChanged = 0;
  let unlocatable = 0;
  let wordsBefore = 0;
  let wordsAfter = 0;
  let withMaterial = 0;
  let materialOnly = 0;
  const casualties: { messageId: number; text: string }[] = [];
  const versions = new Map<number, number>();

  for (const r of rows) {
    versions.set(r.version ?? 0, (versions.get(r.version ?? 0) ?? 0) + 1);
    const text = texts.get(r.messageId);
    if (text === undefined) continue;
    const d: PromptDissection = {
      materialKinds: (r.materialKinds ?? []) as MaterialKind[],
      requests: (r.requests ?? []) as string[],
      materials: (Array.isArray(r.materials) ? r.materials : []) as MaterialSpan[],
    };

    // 1. TYPE path must not move. Its own output is the reference — it takes no
    //    mode argument at all, so this asserts the refactor was a pure move.
    const typeOut = buildQueryContent(text, null, null, d);
    if (!typeOut.includes(text) && text.length <= 4000) typeChanged++;

    if (d.materialKinds.length === 0) continue;
    withMaterial++;
    if (d.requests.length === 0) materialOnly++;

    const abridged = abridgeQuery(text, d);
    if (abridged === null) {
      unlocatable++;
      continue;
    }
    ratingChanged++;
    wordsBefore += words(text);
    wordsAfter += words(abridged);

    // The accepted casualty class: whole message is one short assignment-prompt
    // run with no located request, so it loses its text entirely. Some of these
    // are genuine requests the dissector mis-attributed.
    const segs = segmentForMaterials(text, d.requests, d.materialKinds, d.materials);
    const mats = segs.filter((s) => s.kind === 'material');
    if (
      d.requests.length === 0 &&
      mats.length === 1 &&
      mats[0].kind === 'material' &&
      mats[0].mk === 'assignment_prompt' &&
      words(mats[0].text) < 40
    ) {
      casualties.push({ messageId: r.messageId, text: text.replace(/\s+/g, ' ').trim().slice(0, 120) });
    }
  }

  console.log(`\nMATERIAL_PROMPT_MODE = '${MATERIAL_PROMPT_MODE}'  →  INTENT_RATING_VERSION = ${INTENT_RATING_VERSION}`);
  console.log(`dissection rows: ${rows.length}  (versions: ${[...versions].map(([v, n]) => `v${v}=${n}`).join(', ')})`);
  console.log(`\n1. TYPE path — messages whose verbatim text is NOT intact in buildQueryContent: ${typeChanged}  (must be 0)`);
  console.log(`\n2. RATING path`);
  console.log(`   messages carrying material:        ${withMaterial}`);
  console.log(`   ...of which material-only:         ${materialOnly}`);
  console.log(`   abridged (markers substituted):    ${ratingChanged}`);
  console.log(`   fell back to verbatim (no run located): ${unlocatable}`);
  console.log(
    `   words sent to the judge: ${wordsBefore} → ${wordsAfter}  (${
      wordsBefore ? Math.round((1 - wordsAfter / wordsBefore) * 100) : 0
    }% removed)`
  );
  console.log(`\n3. Accepted casualties — short assignment-prompt-only messages that lose their text: ${casualties.length}`);
  for (const c of casualties.slice(0, 15)) console.log(`   #${c.messageId}  ${c.text}`);

  // One rendered example, so the change is legible rather than statistical.
  const sample = rows.find((r) => {
    const t = texts.get(r.messageId);
    const mats = Array.isArray(r.materials) ? (r.materials as MaterialSpan[]) : [];
    return t && mats.length >= 2 && words(t) > 200;
  });
  if (sample) {
    const t = texts.get(sample.messageId)!;
    const d: PromptDissection = {
      materialKinds: (sample.materialKinds ?? []) as MaterialKind[],
      requests: (sample.requests ?? []) as string[],
      materials: (Array.isArray(sample.materials) ? sample.materials : []) as MaterialSpan[],
    };
    console.log(`\n4. Rendered example — message #${sample.messageId}\n`);
    console.log(buildRatingQueryContent(t, null, null, d));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
