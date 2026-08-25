/**
 * The dataset registry — what a "dataset" IS, now that there can be more than
 * two of them.
 *
 * Everything downstream of curation was already keyed by a dataset KEY and
 * nothing else: study_set_members, study_curation_meta, study_question_bank,
 * the built master's share token, a clone's own token. The only thing pinning
 * the study to exactly {swag, nirvana} was that the list of keys was a constant
 * in config.ts — so a second, smaller curation of the same log had no key to
 * live under and could only be made by destroying the first one.
 *
 * This module turns that list into a table. A dataset is a name, the source log
 * it curates, the title its clones carry, and (for at most two of them) the
 * block of the running study it is the material for. Nothing else in the
 * pipeline had to learn a new concept.
 *
 * Datasets are SHARED, not private: every researcher sees every dataset and can
 * work on it, and `ownerCode` records who made it. A three-person lab hands
 * datasets between its members constantly — a per-account wall would mostly
 * mean the person running the console could not use what the person curating
 * had just built.
 */
import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones, studyDatasets } from '@/db/schema';
import { SEED_DATASETS, SOURCE_LOGS, sourceLog } from './config';
import { ensureStudyTables } from './store';

export interface StudyDataset {
  /** Stable slug: the key every curated/built/cloned row is filed under. */
  key: string;
  label: string;
  /** Which SOURCE_LOG the sets are drawn from. */
  sourceKey: string;
  /** That log's assignment — the master curation reads, resolved for callers. */
  sourceAssignmentId: string;
  /** Participant-facing title for a clone of this dataset. */
  cloneTitle: string;
  /** Researcher code that created it; null for the two seeded datasets. */
  ownerCode: string | null;
  /** Which block of the running study this is the material for (null = idle). */
  slot: 1 | 2 | null;
  createdAt: string;
}

type Row = typeof studyDatasets.$inferSelect;

function hydrate(row: Row): StudyDataset {
  return {
    key: row.key,
    label: row.label,
    sourceKey: row.sourceKey,
    // A dataset whose source log was removed from the code would otherwise
    // hydrate with an empty assignment id and fail deep inside a query. It
    // cannot happen while SOURCE_LOGS is a constant, which is the point of
    // resolving it here rather than storing the id on the row.
    sourceAssignmentId: sourceLog(row.sourceKey)?.masterAssignmentId ?? '',
    cloneTitle: row.cloneTitle,
    ownerCode: row.ownerCode ?? null,
    slot: row.slot === 1 || row.slot === 2 ? row.slot : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every dataset, seeded ones first and then oldest-first. */
export async function listStudyDatasets(): Promise<StudyDataset[]> {
  await ensureStudyTables();
  const rows = await db.select().from(studyDatasets).orderBy(asc(studyDatasets.createdAt));
  return rows.map(hydrate);
}

export async function getStudyDataset(key: string): Promise<StudyDataset | null> {
  await ensureStudyTables();
  const [row] = await db.select().from(studyDatasets).where(eq(studyDatasets.key, key));
  return row ? hydrate(row) : null;
}

/**
 * The dataset, or the error every caller used to throw by hand.
 *
 * The message is load-bearing: the curation state route turns exactly this
 * string into a 404, which is what a stale `?ds=` in someone's tab should get.
 */
export async function requireStudyDataset(key: string): Promise<StudyDataset> {
  const dataset = await getStudyDataset(key);
  if (!dataset) throw new Error(`unknown curation dataset: ${key}`);
  return dataset;
}

/**
 * The two datasets the study is currently made of, in block order.
 *
 * Falls back to the seed pair when fewer than two slots are filled — a study
 * with one block of material is not a study, and every caller here would
 * otherwise have to invent a second dataset for itself.
 */
export async function activeStudyPair(): Promise<StudyDataset[]> {
  const all = await listStudyDatasets();
  const slotted = [1, 2]
    .map((slot) => all.find((d) => d.slot === slot))
    .filter((d): d is StudyDataset => Boolean(d));
  if (slotted.length === 2) return slotted;
  const seeded = SEED_DATASETS.map((s) => all.find((d) => d.key === s.key)).filter(
    (d): d is StudyDataset => Boolean(d)
  );
  return seeded.length === 2 ? seeded : all.slice(0, 2);
}

/** Just the keys, in block order — what a block plan is stamped with. */
export async function activeStudyKeys(): Promise<string[]> {
  return (await activeStudyPair()).map((d) => d.key);
}

/**
 * Point the study at a pair of datasets.
 *
 * Slots are cleared first and set in one transaction, because the partial
 * unique index means "give block 1 to the dataset that currently holds block 2"
 * collides with itself halfway through an unguarded pair of updates.
 *
 * This changes nothing for a participant who already exists: their two datasets
 * were stamped on their row when they were created (provision.ts), and are read
 * from there. The pair is what the NEXT participant is made of.
 */
export async function setStudyPair(block1Key: string, block2Key: string): Promise<StudyDataset[]> {
  if (block1Key === block2Key) throw new Error('same_dataset');
  const [first, second] = await Promise.all([
    requireStudyDataset(block1Key),
    requireStudyDataset(block2Key),
  ]);
  await db.transaction(async (tx) => {
    await tx.update(studyDatasets).set({ slot: null }).where(isNotNull(studyDatasets.slot));
    await tx.update(studyDatasets).set({ slot: 1 }).where(eq(studyDatasets.key, first.key));
    await tx.update(studyDatasets).set({ slot: 2 }).where(eq(studyDatasets.key, second.key));
  });
  return activeStudyPair();
}

/* ------------------------------------------------------------------ */
/* Creating and removing                                               */
/* ------------------------------------------------------------------ */

/** Keys reach share tokens (`<key>-study`, `study-<p>-<key>`), so keep them URL-plain. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function freeKey(base: string): Promise<string> {
  const taken = new Set((await listStudyDatasets()).map((d) => d.key));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('no_free_key');
}

export interface NewDatasetInput {
  label: string;
  sourceKey: string;
  cloneTitle: string;
}

export async function createStudyDataset(
  input: NewDatasetInput,
  ownerCode: string
): Promise<StudyDataset> {
  await ensureStudyTables();
  const label = input.label.trim();
  const cloneTitle = input.cloneTitle.trim();
  if (!label) throw new Error('label_required');
  if (!sourceLog(input.sourceKey)) throw new Error('unknown_source');
  const base = slugify(label);
  if (!base) throw new Error('label_unusable');

  const [row] = await db
    .insert(studyDatasets)
    .values({
      key: await freeKey(base),
      label,
      sourceKey: input.sourceKey,
      // A dataset with no clone title would hand participants the researcher's
      // own name for it, which is the one thing the field exists to prevent.
      cloneTitle: cloneTitle || sourceLog(input.sourceKey)!.label,
      ownerCode,
      slot: null,
      createdAt: new Date(),
    })
    .returning();
  return hydrate(row);
}

/**
 * What stands in the way of deleting a dataset, in the order it matters.
 *
 * Deliberately conservative: a dataset is cheap to make and its curation is
 * hours of someone's judgement, so the refusals name a thing to undo rather
 * than a flag to override.
 */
export async function deleteBlockers(key: string): Promise<string[]> {
  const dataset = await getStudyDataset(key);
  if (!dataset) return ['no such dataset'];
  const out: string[] = [];
  if (dataset.slot) out.push(`it is block ${dataset.slot} of the running study`);
  const [clone] = await db
    .select({ id: studyClones.assignmentId })
    .from(studyClones)
    .where(eq(studyClones.datasetKey, key))
    .limit(1);
  if (clone) out.push('participants hold clones of it');
  return out;
}

/**
 * Remove a dataset and the curation filed under its key.
 *
 * The built master is NOT deleted here. It is an ordinary assignment with its
 * own teardown path, and a build that a participant is mid-session on must not
 * disappear because someone tidied a list — the blockers above are what keep
 * that case out.
 */
export async function deleteStudyDataset(key: string): Promise<void> {
  const blockers = await deleteBlockers(key);
  if (blockers.length > 0) throw new Error(blockers.join('; '));
  if (SEED_DATASETS.some((s) => s.key === key)) throw new Error('the seeded datasets are permanent');
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM "study_set_members" WHERE "dataset_key" = ${key}`);
    await tx.execute(sql`DELETE FROM "study_curation_meta" WHERE "dataset_key" = ${key}`);
    await tx.execute(sql`DELETE FROM "study_question_bank" WHERE "dataset_key" = ${key}`);
    await tx.delete(studyDatasets).where(eq(studyDatasets.key, key));
  });
}

/** Datasets that curate the same log — the ones a new one competes with. */
export async function siblingsOf(key: string): Promise<StudyDataset[]> {
  const dataset = await getStudyDataset(key);
  if (!dataset) return [];
  await ensureStudyTables();
  const rows = await db
    .select()
    .from(studyDatasets)
    .where(and(eq(studyDatasets.sourceKey, dataset.sourceKey), ne(studyDatasets.key, key)));
  return rows.map(hydrate);
}

/** The source logs a dataset may be curated from, for the pickers. */
export function sourceLogOptions(): { key: string; label: string }[] {
  return SOURCE_LOGS.map((s) => ({ key: s.key, label: s.label }));
}
