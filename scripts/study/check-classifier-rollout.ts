/**
 * Did the v3 type gate and the restored subtype text actually reach everything?
 *
 * Three layers can disagree and only one of them is source code:
 *   code   — TYPE_CLASSIFIER_VERSION and the prompt text
 *   master — score_query_types rows, template definitions on the masters
 *   clones — study clones were PROVISIONED from the masters and hold their own
 *            copies of both. A master fix does not travel to them; the clone's
 *            rows are final by design (provision copies, it does not re-derive),
 *            so a stale clone is invisible unless it is looked for.
 *
 * Reports per assignment so a clone that missed the change is named rather than
 * averaged away.
 *
 *   npx tsx --env-file=.env scripts/study/check-classifier-rollout.ts
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { assignments, scoreIntents } from '../../src/db/schema';
import { TYPE_CLASSIFIER_VERSION, intentDefHash, INTENT_RATING_VERSION, MATERIAL_PROMPT_MODE } from '../../src/lib/score/intents';
import { buildTypeSystemPrompt } from '../../src/lib/score/type-prompts';
import { getScoreConfig } from '../../src/lib/score/config-store';
import { buildJelsonSuggestions, jelsonToIntent } from '../../src/lib/score/jelson-suggest';
import { SOURCE_LOGS } from '../../src/lib/study/config';

async function main() {
  /* ── 1. code ── */
  const prompt = buildTypeSystemPrompt();
  const marks: [string, boolean][] = [
    ['substance-first rule', /WHO DECIDES THE CONTENT/.test(prompt)],
    ['scale demoted to a cap', /SCALE then caps translating/.test(prompt)],
    ['material-to-think-about ruling', /supplying material to think ABOUT/.test(prompt)],
    ['fragment-completion ruling', /stopping mid-sentence/.test(prompt)],
    ['v2 scale-first line gone', !/^- Scale separates translating/m.test(prompt)],
  ];
  console.log(`── code ──`);
  console.log(`TYPE_CLASSIFIER_VERSION   ${TYPE_CLASSIFIER_VERSION}`);
  console.log(`rating harness            ${MATERIAL_PROMPT_MODE} · r${INTENT_RATING_VERSION}`);
  for (const [what, ok] of marks) console.log(`  ${ok ? '✓' : '✗'} ${what}`);

  /* ── 2. the chooser text every template must equal ── */
  const config = await getScoreConfig();
  const wantByTitle = new Map(
    buildJelsonSuggestions(config).map((s) => {
      const seed = jelsonToIntent(s);
      return [seed.title.trim().toLowerCase(), seed.definition];
    })
  );

  /* ── 3. per assignment ── */
  const masterIds = new Set(SOURCE_LOGS.map((d) => d.masterAssignmentId));
  const rows = await db.execute(sql`
    select a.id, a.title, a.share_token,
           count(distinct t.id) filter (where t.is_template) as templates,
           count(distinct q.message_id) as typed,
           count(distinct q.message_id) filter (where q.version >= ${TYPE_CLASSIFIER_VERSION}) as typed_current
      from assignments a
      left join score_intents t on t.assignment_id = a.id
      left join score_query_types q on q.assignment_id = a.id
     group by a.id, a.title, a.share_token
    having count(distinct t.id) filter (where t.is_template) > 0
        or count(distinct q.message_id) > 0
     order by a.title
  `);

  console.log(`\n── assignments carrying classifications ──`);
  const stale: string[] = [];
  for (const r of rows as unknown as Record<string, string>[]) {
    const id = String(r.id);
    const nT = Number(r.templates);
    const typed = Number(r.typed);
    const cur = Number(r.typed_current);
    const kind = masterIds.has(id) ? 'MASTER' : 'clone ';

    let drift = 0;
    if (nT > 0) {
      // is_template ONLY. A participant-authored intent may carry a starter's
      // title with an edited definition — that is them working, not drift, and
      // counting it here would raise a false alarm on exactly the clones
      // someone has been using.
      const templates = await db
        .select({ title: scoreIntents.title, definition: scoreIntents.definition })
        .from(scoreIntents)
        .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.isTemplate, true)));
      for (const t of templates) {
        const want = wantByTitle.get(t.title.trim().toLowerCase());
        if (want && want !== t.definition) drift++;
      }
    }
    const typeOk = typed === 0 || cur === typed;
    const defOk = drift === 0;
    if (!typeOk || !defOk) stale.push(`${kind} ${r.title}`);
    console.log(
      `  ${typeOk && defOk ? '✓' : '✗'} ${kind} ${String(r.title).slice(0, 34).padEnd(34)}` +
        ` types ${String(cur).padStart(4)}/${String(typed).padEnd(4)} v${TYPE_CLASSIFIER_VERSION}` +
        `   templates ${String(nT).padStart(2)}${drift ? `  ${drift} DRIFTED` : ''}`
    );
  }

  console.log(
    stale.length === 0
      ? '\nEverything carrying a classification is on the current prompt and text.'
      : `\n${stale.length} behind:\n  ${stale.join('\n  ')}`
  );
  void intentDefHash;
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
