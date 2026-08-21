/**
 * Filling in the handle for an intent whose author did not write one.
 *
 * WHY A LABEL AND NOT CONFIGURATION. A title is read by a person and by
 * nothing else: the judge is given the definition, the chatbot is given the
 * rule, and the per-intent version axis records the (definition, rule) pair
 * and has always left the title out of it. So generating one writes no
 * configuration text and changes nothing about what the chatbot does — the
 * same standing as the version names in name.ts, and the same rule: it happens
 * after the write has already succeeded, and a failure leaves a blank.
 *
 * WHY IT BACKFILLS EVERY VERSION. The title lives inside the snapshot, and the
 * board decides which intents are unsaved by comparing the current snapshot
 * with the last saved one. Writing a generated title into the newest row alone
 * would make that comparison find a difference nobody made, and the tree would
 * mark an intent unsaved for a word the participant never typed. So it fills
 * the blank wherever the blank is, which is what a label backfill should do:
 * no version now says something different from what it said, only something
 * where it used to say nothing.
 *
 * It only ever fills a blank. A title someone typed is never overwritten, and
 * once this has filled one, editing it is theirs and it is not written again.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { simpleConfigVersions } from '@/db/schema';
import { generateIntentTitle } from './name';
import type { SimpleSnapshot } from './chain';

/** sid → the title that was written, for the caller's log. */
export async function fillMissingIntentTitles(
  assignmentId: string,
  snapshot: SimpleSnapshot
): Promise<{ sid: number; title: string }[]> {
  if (snapshot.arm === 'baseline') return [];
  const blank = snapshot.intents.filter(
    (i) => i.title.trim().length === 0 && i.definition.trim().length > 0
  );
  if (blank.length === 0) return [];

  const named: { sid: number; title: string }[] = [];
  for (const intent of blank) {
    const title = await generateIntentTitle(intent.definition);
    if (title) named.push({ sid: intent.sid, title });
  }
  if (named.length === 0) return [];

  // Re-read rather than patching the snapshot we were handed: a save may have
  // landed while the model was thinking, and the blank we are filling might be
  // in rows that did not exist when this started.
  const rows = await db
    .select({ id: simpleConfigVersions.id, snapshot: simpleConfigVersions.snapshot })
    .from(simpleConfigVersions)
    .where(eq(simpleConfigVersions.assignmentId, assignmentId));

  const byId = new Map(named.map((n) => [n.sid, n.title]));
  for (const row of rows) {
    const stored = row.snapshot as { intents?: { sid: number; title?: string }[] };
    if (!Array.isArray(stored.intents)) continue;
    let touched = false;
    const intents = stored.intents.map((intent) => {
      const title = byId.get(Number(intent.sid));
      if (!title || (intent.title ?? '').trim().length > 0) return intent;
      touched = true;
      return { ...intent, title };
    });
    if (!touched) continue;
    await db
      .update(simpleConfigVersions)
      .set({ snapshot: { ...stored, intents } })
      .where(eq(simpleConfigVersions.id, row.id));
  }
  return named;
}
