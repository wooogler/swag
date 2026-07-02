/**
 * SCORE taxonomy + few-shot config.
 *
 * The taxonomy is no longer hardcoded: it is an editable config (4 fixed Types,
 * each with editable Subtypes that carry a code, label, description, and
 * few-shot example queries). The config drives BOTH the viewer and the
 * classifier prompts, is persisted in the DB, and can be exported/imported as
 * JSON. Client-safe (no server/openai imports).
 *
 * The four Type keys are fixed (their colors/grouping depend on them); subtypes
 * within each type are fully editable / add / delete.
 */

export type ScoreTypeKey = 'Planning' | 'Translating' | 'Reviewing' | 'All';

export const SCORE_TYPE_KEYS: ScoreTypeKey[] = ['Planning', 'Translating', 'Reviewing', 'All'];

export const SCORE_CONFIG_VERSION = 1;

/** Cap few-shot examples per subtype so an import/edit can't blow up the prompt. */
export const MAX_EXAMPLES_PER_SUBTYPE = 20;

/** Default Classifier B "fired" threshold (0-10); adjustable live in the viewer. */
export const SCORE_B_THRESHOLD = 6;

/**
 * Version of the SHARED Classifier B rubric (the fixed scoring instructions that
 * are identical for every subtype — see buildSystemBSingle). Bump this to force a
 * global re-score of B when the rubric wording/scale changes. Per-subtype edits
 * are handled automatically by subtypeDefHash; this is only for the shared part.
 *
 * v2: type-scope rules (whose text is operated on), instruction-vs-pasted-text
 * rule, parent Type header in the subtype block, compact B context.
 * v3: dropped the non-paper interpretive rules (scope/whose-text, instruction-
 * vs-pasted-text, referent resolution) and reworded the rubric so scoring is
 * driven only by the paper's own Type/Subtype descriptions + examples.
 */
export const SCORE_B_RUBRIC_VERSION = 3;

/** Max few-shot examples included in a single-subtype B call (the rest are kept
 * in config for the viewer/Classifier A but not sent to B — keeps the per-call
 * variable suffix small). subtypeDefHash hashes the same slice. */
export const B_MAX_EXAMPLES_PER_CALL = 6;

export interface ScoreConfigSubtype {
  code: string;
  label: string;
  description: string;
  examples: string[];
}

export interface ScoreConfigType {
  key: ScoreTypeKey;
  letter: string; // P / T / R / A
  label: string;
  description: string;
  subtypes: ScoreConfigSubtype[];
}

export interface ScoreConfig {
  version: number;
  types: ScoreConfigType[];
  /** Example queries that fit NO subtype (off-topic, chit-chat, meta). Few-shot
   * the "none of the above" case: Classifier A returns null, B scores all 0. */
  noneExamples: string[];
}

export function isValidTypeKey(key: string | null | undefined): key is ScoreTypeKey {
  return key === 'Planning' || key === 'Translating' || key === 'Reviewing' || key === 'All';
}

export function flattenSubtypes(
  config: ScoreConfig
): { type: ScoreConfigType; subtype: ScoreConfigSubtype }[] {
  return config.types.flatMap((type) => type.subtypes.map((subtype) => ({ type, subtype })));
}

export function allCodes(config: ScoreConfig): string[] {
  return config.types.flatMap((t) => t.subtypes.map((s) => s.code));
}

/** Small, stable (non-crypto) string hash. Pure JS so config.ts stays
 * client-safe; used only for cache-invalidation keys, not security. */
function stableHash(input: string): string {
  // Two independent FNV-1a-style accumulators combined → ~13 base36 chars, low
  // enough collision risk for the (subtype-definition → re-score) decision.
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/**
 * Content hash of everything that affects a subtype's Classifier B score in
 * isolation: the shared rubric version + the parent Type's header (its label/
 * letter/description appear in the B prompt) + this subtype's code/label/
 * description/examples (only the slice actually sent — B_MAX_EXAMPLES_PER_CALL).
 * It deliberately does NOT depend on any SIBLING subtype — that is what makes a
 * per-subtype edit re-score only that subtype. Store it alongside each
 * (message, subtype) score; a mismatch vs the current config means "re-score".
 */
export function subtypeDefHash(type: ScoreConfigType, subtype: ScoreConfigSubtype): string {
  const sent = subtype.examples.slice(0, B_MAX_EXAMPLES_PER_CALL);
  // JSON-encode so instructor-entered '|' or embedded newlines can't make two
  // different definitions collapse to the same canonical string.
  const canonical = JSON.stringify([
    `v${SCORE_B_RUBRIC_VERSION}`,
    type.key,
    type.letter,
    type.label,
    type.description,
    subtype.code,
    subtype.label,
    subtype.description,
    sent,
  ]);
  return stableHash(canonical);
}

export function getSubtypeFromConfig(
  config: ScoreConfig,
  code: string | null | undefined
): ScoreConfigSubtype | undefined {
  if (!code) return undefined;
  for (const t of config.types) {
    for (const s of t.subtypes) {
      if (s.code === code) return s;
    }
  }
  return undefined;
}

export function typeKeyOfCode(
  config: ScoreConfig,
  code: string | null | undefined
): ScoreTypeKey | undefined {
  if (!code) return undefined;
  for (const t of config.types) {
    if (t.subtypes.some((s) => s.code === code)) return t.key;
  }
  return undefined;
}

export function isValidCode(config: ScoreConfig, code: string | null | undefined): boolean {
  return !!getSubtypeFromConfig(config, code);
}

/** "PL01 · Provide an answer to a question on a topic" — falls back to the bare code if unknown. */
export function subtypeLabelOf(config: ScoreConfig, code: string): string {
  const s = getSubtypeFromConfig(config, code);
  return s ? `${s.code} · ${s.label}` : code;
}

/**
 * Validate + coerce an arbitrary parsed JSON object into a ScoreConfig (for
 * import). Returns null if it is not recognizably a config. Lenient about extra
 * fields; strict about the required shape.
 */
export function normalizeConfig(raw: unknown): ScoreConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const typesRaw = obj.types;
  if (!Array.isArray(typesRaw)) return null;

  const types: ScoreConfigType[] = [];
  const seenCodes = new Set<string>();

  for (const t of typesRaw) {
    if (!t || typeof t !== 'object') continue;
    const tt = t as Record<string, unknown>;
    if (!isValidTypeKey(tt.key as string)) continue;
    const key = tt.key as ScoreTypeKey;
    const subtypesRaw = Array.isArray(tt.subtypes) ? tt.subtypes : [];
    const subtypes: ScoreConfigSubtype[] = [];
    for (const s of subtypesRaw) {
      if (!s || typeof s !== 'object') continue;
      const ss = s as Record<string, unknown>;
      // Codes are normalized to uppercase so they match the LLM-returned codes
      // (classifyA uppercases) and lookups everywhere.
      const code = typeof ss.code === 'string' ? ss.code.trim().toUpperCase() : '';
      if (!code || seenCodes.has(code)) continue; // codes must be unique & non-empty
      seenCodes.add(code);
      const label = typeof ss.label === 'string' ? ss.label : code;
      const description = typeof ss.description === 'string' ? ss.description : label;
      const examples = Array.isArray(ss.examples)
        ? ss.examples
            .filter((e): e is string => typeof e === 'string')
            .map((e) => e.trim())
            .filter(Boolean)
            .slice(0, MAX_EXAMPLES_PER_SUBTYPE)
        : [];
      subtypes.push({ code, label, description, examples });
    }
    types.push({
      key,
      letter: typeof tt.letter === 'string' ? tt.letter : key[0],
      label: typeof tt.label === 'string' ? tt.label : key,
      description: typeof tt.description === 'string' ? tt.description : '',
      subtypes,
    });
  }

  // Ensure all four types exist (preserve order Planning/Translating/Reviewing/All).
  const byKey = new Map(types.map((t) => [t.key, t]));
  const ordered: ScoreConfigType[] = SCORE_TYPE_KEYS.map(
    (key) =>
      byKey.get(key) ?? {
        key,
        letter: key[0],
        label: key,
        description: '',
        subtypes: [],
      }
  );

  if (ordered.every((t) => t.subtypes.length === 0)) return null; // nothing usable

  const noneExamples = Array.isArray(obj.noneExamples)
    ? obj.noneExamples
        .filter((e): e is string => typeof e === 'string')
        .map((e) => e.trim())
        .filter(Boolean)
        .slice(0, MAX_EXAMPLES_PER_SUBTYPE)
    : [];

  return { version: SCORE_CONFIG_VERSION, types: ordered, noneExamples };
}
