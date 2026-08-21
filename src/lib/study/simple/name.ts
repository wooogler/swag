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
    if (before.parentSid !== intent.parentSid) changed.push('moved to a different place in the tree');
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
  return snapshot.intents.map((i) => `${i.sid}<${i.parentSid ?? 'root'}`).join(',');
}

function clip(text: string, max = 800): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '(empty)';
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export async function generateVersionName(
  next: SimpleSnapshot,
  prev: SimpleSnapshot | null
): Promise<{ name: string; summary: string } | null> {
  try {
    const raw = await callModel(
      SYSTEM,
      describeChange(next, prev),
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
