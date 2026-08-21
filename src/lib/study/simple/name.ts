/**
 * A name and a one-line summary for a saved version.
 *
 * The one place a model touches this version other than judging and answering,
 * and the exception is deliberate: it writes no configuration text and reads
 * only what has already been written (§1). It is metadata for the timeline —
 * "Softer on grammar questions" beats "v7 · 14:02" when you are looking for
 * where you were ten minutes ago — and nothing depends on it. It is generated
 * after the save has already succeeded, and a failure leaves the timestamp
 * label in place.
 *
 * The smallest model available, because it is describing a diff someone
 * already knows they made.
 */
import { callModel, extractJsonObject } from '@/lib/score/classifier';
import type { SimpleSnapshot } from './chain';

const NAME_MODEL = process.env.SCORE_TITLE_MODEL || 'gpt-5.4-nano';

const SYSTEM = `You label saved versions of a chatbot configuration for the person who wrote it, in the style of a git commit subject.

You are given what changed between two versions of the configuration. Return:
- "name": at most 6 words, capitalized like a sentence, no trailing period. Say what changed, not that something changed.
- "summary": one sentence, at most 20 words, describing the change.

Describe only what the diff shows. Do not evaluate the change, do not suggest anything, and do not guess at intentions that are not in the text.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'summary'],
  properties: {
    name: { type: 'string', description: 'at most 6 words, no trailing period' },
    summary: { type: 'string', description: 'one sentence, at most 20 words' },
  },
};

/** Only what a reader needs to name the change: the fields that differ. */
function describeChange(next: SimpleSnapshot, prev: SimpleSnapshot | null): string {
  if (next.arm === 'baseline') {
    const before = prev?.prompt ?? '';
    if (!prev) return `First save. The rules document now reads:\n${clip(next.prompt)}`;
    if (before === next.prompt) return `Saved with no change to the rules document.`;
    return `The rules document changed.\n\nBEFORE:\n${clip(before)}\n\nAFTER:\n${clip(next.prompt)}`;
  }

  const lines: string[] = [];
  const prevById = new Map((prev?.intents ?? []).map((i) => [i.sid, i]));
  const nextById = new Map(next.intents.map((i) => [i.sid, i]));

  for (const intent of next.intents) {
    const before = prevById.get(intent.sid);
    if (!before) {
      lines.push(
        `ADDED intent "${intent.title}"\n  when: ${clip(intent.definition, 400)}\n  then: ${clip(intent.rule, 600)}`
      );
      continue;
    }
    const changed: string[] = [];
    if (before.title !== intent.title) changed.push(`title: "${before.title}" → "${intent.title}"`);
    if (before.definition !== intent.definition) {
      changed.push(`when, was: ${clip(before.definition, 300)}\n  when, now: ${clip(intent.definition, 300)}`);
    }
    if (before.rule !== intent.rule) {
      changed.push(`then, was: ${clip(before.rule, 400)}\n  then, now: ${clip(intent.rule, 400)}`);
    }
    if (changed.length > 0) lines.push(`CHANGED intent "${intent.title}"\n  ${changed.join('\n  ')}`);
  }
  for (const intent of prev?.intents ?? []) {
    if (!nextById.has(intent.sid)) lines.push(`REMOVED intent "${intent.title}"`);
  }
  if ((prev?.rootRule ?? '') !== next.rootRule) {
    lines.push(
      `CHANGED the rule for everything else\n  was: ${clip(prev?.rootRule ?? '', 400)}\n  now: ${clip(next.rootRule, 400)}`
    );
  }
  // Same fields, different array order: the only thing that can have changed
  // is which intent gets a question first.
  if (lines.length === 0 && prev && orderOf(prev) !== orderOf(next)) {
    lines.push('REORDERED the intents, changing which one answers a question first.');
  }
  if (lines.length === 0) return 'Saved with no change to the configuration.';
  return lines.join('\n\n');
}

function orderOf(snapshot: SimpleSnapshot): string {
  return snapshot.intents.map((i) => i.sid).join(',');
}

function clip(text: string, max = 800): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '(empty)';
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * The same job for ONE intent: what changed in this when/then pair.
 *
 * Narrower input than the configuration-wide describer above, and better for
 * it — the model is looking at two short texts rather than a whole tree, so
 * the label it writes is about the edit the participant just made rather than
 * about the biggest thing on screen.
 */
function describeIntentChange(
  next: { title: string; definition: string; rule: string },
  prev: { definition: string; rule: string } | null
): string {
  if (!prev) {
    return `First version of "${next.title}".\n\nwhen: ${clip(next.definition, 600)}\n\nthen: ${clip(next.rule, 900)}`;
  }
  const parts: string[] = [];
  if (prev.definition !== next.definition) {
    parts.push(
      `The WHEN changed.\n\nBEFORE:\n${clip(prev.definition, 500)}\n\nAFTER:\n${clip(next.definition, 500)}`
    );
  }
  if (prev.rule !== next.rule) {
    parts.push(
      `The THEN changed.\n\nBEFORE:\n${clip(prev.rule, 700)}\n\nAFTER:\n${clip(next.rule, 700)}`
    );
  }
  if (parts.length === 0) return `"${next.title}" saved with no change.`;
  return `Intent "${next.title}".\n\n${parts.join('\n\n')}`;
}

const TITLE_SYSTEM = `You give a short handle to a category of student questions, for the person who wrote the description of it.

You are given the description they wrote. Return "name": at most 4 words, capitalized like a sentence, no trailing period, naming the KIND of question the description picks out.

Use their words where you can. Do not evaluate the description, do not broaden or narrow it, do not add anything that is not in it, and never write the word "intent".`;

const TITLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', description: 'at most 4 words, no trailing period' } },
};

/**
 * A handle for an intent whose author did not give it one.
 *
 * Same standing as a version name and for the same reason: a title is read by
 * a person and by nothing else. It is never sent to the judge, never sent to
 * the chatbot, and deliberately left out of the per-intent version axis, which
 * records the (definition, rule) pair — so it changes nothing about what the
 * configuration does. Asking someone to name a category before they have
 * finished describing it is asking twice for the same thing.
 *
 * Only ever fills a blank. A title the participant typed is never touched, and
 * once this has filled one it is theirs to edit and is not written again.
 */
export async function generateIntentTitle(definition: string): Promise<string | null> {
  const text = definition.trim();
  if (text.length === 0) return null;
  try {
    const raw = await callModel(
      TITLE_SYSTEM,
      `The description they wrote:\n${clip(text, 900)}`,
      NAME_MODEL,
      'low',
      { name: 'intent_title', schema: TITLE_SCHEMA as Record<string, unknown> },
      { timeoutMs: 20_000, maxRetries: 1 }
    );
    const parsed = extractJsonObject(raw);
    const name = typeof parsed.name === 'string' ? parsed.name.trim().replace(/\.$/, '') : '';
    if (name.length === 0 || name.length > 60) return null;
    return name;
  } catch (error) {
    console.error('simple intent title failed (leaving it untitled):', error);
    return null;
  }
}

export async function generateIntentVersionName(
  next: { title: string; definition: string; rule: string },
  prev: { definition: string; rule: string } | null
): Promise<{ name: string; summary: string } | null> {
  return runNamer(describeIntentChange(next, prev));
}

export async function generateVersionName(
  next: SimpleSnapshot,
  prev: SimpleSnapshot | null
): Promise<{ name: string; summary: string } | null> {
  return runNamer(describeChange(next, prev));
}

/** One call, one label, null on anything going wrong. */
async function runNamer(input: string): Promise<{ name: string; summary: string } | null> {
  try {
    const raw = await callModel(
      SYSTEM,
      input,
      NAME_MODEL,
      'low',
      { name: 'version_name', schema: SCHEMA as Record<string, unknown> },
      { timeoutMs: 20_000, maxRetries: 1 }
    );
    const parsed = extractJsonObject(raw);
    const name = typeof parsed.name === 'string' ? parsed.name.trim().replace(/\.$/, '') : '';
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (name.length === 0 || name.length > 80) return null;
    return { name, summary };
  } catch (error) {
    console.error('simple version name failed (keeping the timestamp label):', error);
    return null;
  }
}
