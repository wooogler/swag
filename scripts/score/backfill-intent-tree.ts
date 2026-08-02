/**
 * P0.12 — v7 intent-tree backfill.
 *
 * Brings existing assignments up to the shape the v7 routing layer expects:
 *   1. every assignment that has intents gets its 4 type roots (ensureTypeRoots)
 *   2. every live intent (kind='intent', not a template) gets a `type`
 *   3. `position` is deliberately left NULL — the effective order is
 *      (position ?? id), so untouched rows already sort by creation order
 *
 * Typing rule (D7): an intent whose definition is byte-identical (trimmed) to a
 * starter-library definition inherits that library entry's type — the same
 * definition-string identity the board already uses to match live intents to
 * starter sets. Everything else falls back to 'drafting' (the type that absorbs
 * multi-activity requests) and is listed in the report for manual correction.
 * score_classifications.type_a is deliberately NOT a source: it predates
 * material substitution and its 'All' carried different semantics.
 *
 * Usage:
 *   npx tsx scripts/score/backfill-intent-tree.ts            # report only
 *   npx tsx scripts/score/backfill-intent-tree.ts --apply    # write
 *   npx tsx scripts/score/backfill-intent-tree.ts --apply --assignment <id>
 *
 * Idempotent: re-running only touches rows that are still untyped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
// Type-only: erased at compile time, so it cannot pull db/openai in before the
// .env loader below has run.
import type { ScoreQueryType } from '../../src/lib/score/intents';

// .env before anything imports db/openai (same order as stability-check.ts).
for (const file of ['.env.local', '.env']) {
  try {
    const text = readFileSync(path.join(process.cwd(), file), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* file absent — fine */
  }
}

const APPLY = process.argv.includes('--apply');
const assignmentArgIdx = process.argv.indexOf('--assignment');
const ONLY_ASSIGNMENT = assignmentArgIdx > -1 ? process.argv[assignmentArgIdx + 1] : null;

async function main(): Promise<void> {
  const { db } = await import('../../src/db/db');
  const { scoreIntents } = await import('../../src/db/schema');
  const { and, eq, isNull, sql } = await import('drizzle-orm');
  const { ensureIntentTables, ensureTypeRoots } = await import('../../src/lib/score/intent-store');
  const { getScoreConfig } = await import('../../src/lib/score/config-store');
  const { buildJelsonSuggestions, jelsonToIntent, jelsonTypeToIntent } = await import(
    '../../src/lib/score/jelson-suggest'
  );
  await ensureIntentTables();

  // --- starter-library definition → type ------------------------------------
  // Legacy Jelson type keys map to v7 query types; 'All' is v7's 'drafting'.
  const LEGACY_TO_QUERY_TYPE: Record<string, ScoreQueryType> = {
    Planning: 'planning',
    Translating: 'translating',
    Reviewing: 'reviewing',
    All: 'drafting',
  };
  const config = await getScoreConfig();
  const suggestions = buildJelsonSuggestions(config);
  const typeByDefinition = new Map<string, ScoreQueryType>();
  for (const s of suggestions) {
    const qt = LEGACY_TO_QUERY_TYPE[s.typeKey];
    if (!qt) continue;
    typeByDefinition.set(jelsonToIntent(s).definition.trim(), qt);
  }
  // Whole-Type starter intents (one intent covering an entire type).
  for (const t of config.types) {
    const qt = LEGACY_TO_QUERY_TYPE[t.key];
    if (!qt) continue;
    typeByDefinition.set(jelsonTypeToIntent(t.key, t.label, t.description).definition.trim(), qt);
  }

  // --- assignments in scope --------------------------------------------------
  const scopeRows = await db.execute<{ assignment_id: string; n: number }>(sql`
    SELECT assignment_id, COUNT(*)::int AS n FROM score_intents
    ${ONLY_ASSIGNMENT ? sql`WHERE assignment_id = ${ONLY_ASSIGNMENT}` : sql``}
    GROUP BY assignment_id ORDER BY assignment_id
  `);
  if (scopeRows.length === 0) {
    console.log('No assignments with intents found — nothing to back-fill.');
    return;
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${scopeRows.length} assignment(s) with intents\n`);

  let rootsCreated = 0;
  let typedFromLibrary = 0;
  const fallbacks: { assignmentId: string; id: number; title: string }[] = [];

  for (const { assignment_id: assignmentId } of scopeRows) {
    // 1) type roots
    if (APPLY) {
      const before = await db
        .select({ id: scoreIntents.id })
        .from(scoreIntents)
        .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.kind, 'type_root')));
      const roots = await ensureTypeRoots(assignmentId);
      rootsCreated += roots.length - before.length;
    }

    // 2) live intents still missing a type
    const untyped = await db
      .select({
        id: scoreIntents.id,
        title: scoreIntents.title,
        definition: scoreIntents.definition,
        isTemplate: scoreIntents.isTemplate,
        archived: scoreIntents.archived,
      })
      .from(scoreIntents)
      .where(
        and(
          eq(scoreIntents.assignmentId, assignmentId),
          eq(scoreIntents.kind, 'intent'),
          isNull(scoreIntents.type)
        )
      );

    for (const row of untyped) {
      // Starter templates stay untyped ON PURPOSE: they are rated whole-log and
      // back the baseline condition's presets/searches. Typing one would scope
      // its judgments to a single type and blank the preset results.
      if (row.isTemplate) continue;
      const matched = typeByDefinition.get(row.definition.trim());
      const type: ScoreQueryType = matched ?? 'drafting';
      if (matched) typedFromLibrary++;
      else fallbacks.push({ assignmentId, id: row.id, title: row.title });
      if (APPLY) {
        await db
          .update(scoreIntents)
          .set({ type, updatedAt: new Date() })
          .where(eq(scoreIntents.id, row.id));
      }
      console.log(
        `  ${assignmentId.slice(0, 8)}… #${row.id} ${matched ? '→' : '?→'} ${type}` +
          `${row.archived ? ' (archived)' : ''}  ${row.title.slice(0, 60)}`
      );
    }
  }

  console.log('\n--- summary ---');
  console.log(`type roots created:            ${APPLY ? rootsCreated : '(dry run)'}`);
  console.log(`intents typed from library:    ${typedFromLibrary}`);
  console.log(`intents defaulted to drafting: ${fallbacks.length}`);
  if (fallbacks.length > 0) {
    console.log('\nNEEDS REVIEW — no starter-library definition matched, defaulted to drafting:');
    for (const f of fallbacks) {
      console.log(`  ${f.assignmentId} #${f.id}  ${f.title}`);
    }
    console.log('\nRe-type any of these by hand (UPDATE score_intents SET type=… WHERE id=…);');
    console.log('a wrong type is not recoverable downstream — the intent only ever sees that');
    console.log("type's queries.");
  }
  if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
