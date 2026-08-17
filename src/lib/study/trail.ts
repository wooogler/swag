/**
 * One participant's session, flattened onto a single clock.
 *
 * RQ1 asks how an instructor organises intent into a configuration as they
 * work, which is a question about ORDER — what came before what, how long
 * after, and what got undone. The data to answer it already exists, but spread
 * across six tables with different shapes and no shared notion of "when in the
 * session". This module joins them into one list of typed events.
 *
 * The snapshot table is the source of truth for SCORE. `score_config_versions`
 * stores the whole tree on every save, so what changed is recovered by diffing
 * adjacent versions rather than by trusting a parallel event stream — there is
 * one record of the configuration, and it is the one the tool itself uses.
 * `study_events` adds only the acts that leave no snapshot (corrections, rule
 * rewinds, suggestion calls); see STUDY_TRAIL_SPEC §2.
 *
 * Read-only and derived: nothing here writes, and a rebuild after new events
 * arrive simply produces a longer list.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  baselinePromptVersions,
  scoreChatDeploys,
  scoreConfigVersions,
  scoreRuleVersions,
  studyClones,
  studyEvents,
  studyParticipants,
  studyQuestionBank,
  studySurveyAnswers,
  studyTestAnswers,
  type StudyParticipant,
} from '@/db/schema';
import { blockPlan, cellOf } from './phases';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TrailSource =
  | 'snapshot'
  | 'event'
  | 'rule'
  | 'prompt'
  | 'deploy'
  | 'test'
  | 'survey'
  | 'session';

export interface TrailEvent {
  /** 1-based, in time order across the whole session. */
  seq: number;
  at: string;
  /** Seconds since this block's work phase opened; null outside a block. */
  tBlock: number | null;
  block: 1 | 2 | null;
  condition: 'score' | 'baseline' | null;
  phase: string;
  source: TrailSource;
  kind: string;
  intentId: number | null;
  intentTitle: string | null;
  messageId: number | null;
  /** One human-readable line — what the CSV shows. */
  detail: string | null;
  /** Everything else, JSONL only. */
  payload: Record<string, unknown> | null;
}

export interface TrailBlock {
  block: 1 | 2;
  datasetKey: string;
  condition: 'score' | 'baseline';
  assignmentId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Where t=0 came from: the phase event, or the first thing they did. */
  tZeroSource: 'phase' | 'first_action' | 'none';
  events: number;
}

export interface TrailSnapshot {
  block: 1 | 2 | null;
  versionNo: number;
  createdAt: string;
  summary: unknown;
  snapshot: unknown;
}

export interface TrailRuleVersion {
  block: 1 | 2 | null;
  kind: 'score_rule' | 'baseline_prompt';
  intentId: number | null;
  versionNo: number;
  source: string | null;
  minor: boolean | null;
  text: string;
  createdAt: string;
  deployedAt: string | null;
}

export interface ParticipantTrail {
  participant: {
    id: string;
    number: string;
    cell: number;
    blockOrder: string[];
    createdAt: string | null;
    lastLoginAt: string | null;
  };
  blocks: TrailBlock[];
  events: TrailEvent[];
  snapshots: TrailSnapshot[];
  rules: TrailRuleVersion[];
  final: { block: 1 | 2; condition: 'score' | 'baseline'; config: unknown }[];
}

/* ------------------------------------------------------------------ */
/* Snapshot diff                                                       */
/* ------------------------------------------------------------------ */

interface SnapIntent {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  archived?: boolean;
  isTemplate?: boolean;
  kind?: string;
  parentIntentId?: number | null;
  position?: number | null;
}
interface SnapPin {
  intentId: number;
  messageId: number;
  verdict: string;
}
interface Snap {
  intents?: SnapIntent[];
  pins?: SnapPin[];
}

interface Summary {
  action?: string;
  intentIds?: number[];
  messageId?: number;
  detail?: string;
  minor?: boolean;
}

/**
 * The intents the PARTICIPANT is working on.
 *
 * A clone arrives holding the master's template set — three dozen rows the
 * participant never touched. Diffing those in would open every SCORE block
 * with three dozen "created an intent" rows and bury the one they actually
 * made. Templates are dropped; type roots stay, because writing a fallback
 * rule on one IS their work.
 */
function intentsOf(snap: unknown): Map<number, SnapIntent> {
  const list = (snap as Snap | null)?.intents ?? [];
  return new Map(
    list
      .filter((i) => i && typeof i.id === 'number' && !i.isTemplate && i.kind !== 'prompt_holder')
      .map((i) => [i.id, i])
  );
}

function pinKeys(snap: unknown): Set<string> {
  const list = (snap as Snap | null)?.pins ?? [];
  return new Set(list.map((p) => `${p.intentId}:${p.messageId}:${p.verdict}`));
}

/**
 * What changed between two adjacent snapshots, as one or more events.
 *
 * `summary.action` says WHAT KIND of change the tool thought it was making;
 * the diff says WHICH FIELDS actually moved. Both are used — the action alone
 * cannot distinguish a definition edit from a rule edit (both are
 * `update_intent`), and the diff alone cannot tell an archive from a delete.
 */
function diffSnapshots(prev: unknown, next: unknown, summary: Summary): {
  kind: string;
  intentId: number | null;
  detail: string;
}[] {
  const before = intentsOf(prev);
  const after = intentsOf(next);
  const out: { kind: string; intentId: number | null; detail: string }[] = [];
  const via = summary.detail ? ` · ${summary.detail}` : '';

  // The first version is the state the block STARTED in — the type roots the
  // clone was provisioned with, plus whatever act triggered the first save.
  // Reported as one line: the full seed is in snapshots/v001.json, and listing
  // it as N creations would read as work nobody did.
  if (prev === null) {
    const authored = [...after.values()].filter((i) => i.kind === 'intent');
    const seeded: { kind: string; intentId: number | null; detail: string }[] = [
      {
        kind: 'config_seed',
        intentId: null,
        detail: `${after.size} entr${after.size === 1 ? 'y' : 'ies'} at block start`,
      },
    ];
    // …except the intent this very save created, which IS the participant's.
    for (const id of summary.intentIds ?? []) {
      const mine = after.get(id);
      if (mine && mine.kind === 'intent' && authored.includes(mine)) {
        seeded.push({ kind: 'intent_create', intentId: id, detail: `“${mine.title}”${via}` });
      }
    }
    return seeded;
  }

  if (summary.action === 'revert') {
    return [
      {
        kind: 'intent_revert',
        intentId: summary.intentIds?.[0] ?? null,
        detail: `rewound${via}`,
      },
    ];
  }

  for (const [id, now] of after) {
    const was = before.get(id);
    if (!was) {
      out.push({ kind: 'intent_create', intentId: id, detail: `“${now.title}”${via}` });
      continue;
    }
    if (!!was.archived !== !!now.archived) {
      out.push({
        kind: now.archived ? 'intent_archive' : 'intent_restore',
        intentId: id,
        detail: `“${now.title}”`,
      });
    }
    if (was.definition !== now.definition) {
      const d = now.definition.length - was.definition.length;
      out.push({
        kind: 'intent_update_definition',
        intentId: id,
        detail: `“${now.title}” Δ${d >= 0 ? '+' : ''}${d} chars${via}`,
      });
    }
    if ((was.rule ?? '') !== (now.rule ?? '')) {
      const d = (now.rule ?? '').length - (was.rule ?? '').length;
      out.push({
        kind: 'intent_update_rule',
        intentId: id,
        detail: `“${now.title}” Δ${d >= 0 ? '+' : ''}${d} chars${via}`,
      });
    }
    if (was.title !== now.title && was.definition === now.definition) {
      out.push({
        kind: 'intent_update_title',
        intentId: id,
        detail: `“${was.title}” → “${now.title}”`,
      });
    }
    if ((was.parentIntentId ?? null) !== (now.parentIntentId ?? null)) {
      const parent = now.parentIntentId ? after.get(now.parentIntentId)?.title : null;
      out.push({
        kind: 'intent_move',
        intentId: id,
        detail: `“${now.title}” → ${parent ? `inside “${parent}”` : 'top level'}`,
      });
    } else if ((was.position ?? null) !== (now.position ?? null)) {
      out.push({ kind: 'intent_reorder', intentId: id, detail: `“${now.title}”` });
    }
  }

  // A fold rewrites definitions from corrections; the tool records it as an
  // update, so the label comes from the provenance tag rather than the diff.
  if (/fold/i.test(summary.detail ?? '')) {
    for (const e of out) if (e.kind === 'intent_update_definition') e.kind = 'intent_fold';
  }

  const pinsBefore = pinKeys(prev);
  const pinsAfter = pinKeys(next);
  const added = [...pinsAfter].filter((k) => !pinsBefore.has(k)).length;
  const removed = [...pinsBefore].filter((k) => !pinsAfter.has(k)).length;
  if (added || removed) {
    out.push({
      kind: 'pins_changed',
      intentId: summary.intentIds?.[0] ?? null,
      detail: `${added ? `+${added}` : ''}${added && removed ? ' ' : ''}${removed ? `−${removed}` : ''}`,
    });
  }

  // An Apply persists the spec without changing any field the snapshot holds.
  if (out.length === 0) {
    out.push({
      kind: summary.minor ? 'intent_apply' : 'intent_update',
      intentId: summary.intentIds?.[0] ?? null,
      detail: summary.detail ?? summary.action ?? '',
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function buildParticipantTrail(
  participantOrId: string | StudyParticipant
): Promise<ParticipantTrail | null> {
  const participant =
    typeof participantOrId === 'string'
      ? (
          await db.select().from(studyParticipants).where(eq(studyParticipants.id, participantOrId))
        )[0]
      : participantOrId;
  if (!participant) return null;

  const plan = blockPlan(participant);
  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  const cloneByDataset = new Map(clones.map((c) => [c.datasetKey, c]));
  const assignmentIds = clones.map((c) => c.assignmentId);

  /** Which block an assignment belongs to, and in which condition. */
  const blockOf = new Map<string, { block: 1 | 2; condition: 'score' | 'baseline' }>();
  for (const p of plan) {
    const clone = cloneByDataset.get(p.datasetKey);
    if (clone) {
      blockOf.set(clone.assignmentId, {
        block: p.block,
        condition: clone.condition === 'baseline' ? 'baseline' : 'score',
      });
    }
  }

  const [events, versions, ruleRows, promptRows, deployRows, testRows, surveyRows, bank] =
    await Promise.all([
      db
        .select()
        .from(studyEvents)
        .where(eq(studyEvents.participantId, participant.id))
        .orderBy(asc(studyEvents.createdAt)),
      assignmentIds.length
        ? db
            .select()
            .from(scoreConfigVersions)
            .where(inArray(scoreConfigVersions.assignmentId, assignmentIds))
            .orderBy(asc(scoreConfigVersions.versionNo))
        : [],
      assignmentIds.length
        ? db
            .select()
            .from(scoreRuleVersions)
            .where(inArray(scoreRuleVersions.assignmentId, assignmentIds))
        : [],
      assignmentIds.length
        ? db
            .select()
            .from(baselinePromptVersions)
            .where(inArray(baselinePromptVersions.assignmentId, assignmentIds))
        : [],
      assignmentIds.length
        ? db
            .select()
            .from(scoreChatDeploys)
            .where(inArray(scoreChatDeploys.assignmentId, assignmentIds))
        : [],
      assignmentIds.length
        ? db
            .select()
            .from(studyTestAnswers)
            .where(inArray(studyTestAnswers.cloneAssignmentId, assignmentIds))
        : [],
      db
        .select()
        .from(studySurveyAnswers)
        .where(eq(studySurveyAnswers.participantId, participant.id)),
      db.select().from(studyQuestionBank),
    ]);

  // Assignment-scoped events are keyed by assignment, participant-scoped ones
  // (phases) by participant — both land in the same list.
  const assignmentEvents = assignmentIds.length
    ? await db
        .select()
        .from(studyEvents)
        .where(inArray(studyEvents.assignmentId, assignmentIds))
        .orderBy(asc(studyEvents.createdAt))
    : [];

  const bankPos = new Map(bank.map((b) => [b.id, b.position]));

  /* -- raw rows → events ------------------------------------------- */
  type Raw = Omit<TrailEvent, 'seq' | 'tBlock' | 'block' | 'condition' | 'phase' | 'intentTitle'> & {
    assignmentId: string | null;
  };
  const raw: Raw[] = [];

  // Session-level (phases, admin actions).
  for (const e of events) {
    raw.push({
      at: iso(e.createdAt)!,
      source: 'session',
      kind: e.eventType,
      intentId: null,
      messageId: null,
      detail:
        e.eventType === 'phase_advance' || e.eventType === 'phase_forced'
          ? `${(e.payload as { from?: string })?.from ?? '?'} → ${(e.payload as { to?: string })?.to ?? '?'}`
          : null,
      payload: (e.payload as Record<string, unknown>) ?? null,
      assignmentId: null,
    });
  }

  // Work events (the ones Step 1 added, plus the ones already there).
  //
  // Some of these predate the trail and duplicate a row the tables already
  // produce — `intent_create` is in every snapshot diff, `rule_save` is a row
  // in score_rule_versions. Keeping both would make any count of them come out
  // double, and the table is the one that carries the detail, so the event
  // loses. This is the module's rule applied literally: events add only what
  // the tables cannot see.
  const DUPLICATES_A_TABLE = new Set(['rule_save', 'deploy', 'prompt_save', 'prompt_deploy']);
  // `intent_create` is not a duplicate, it is a DIFFERENT act. The board's New
  // Intent button posts a draft — that is when this event fires — and the
  // workbench's Save is what puts the intent on the board, which is what the
  // snapshot records as create_intent. Dropping the event would make a draft
  // the participant opened and abandoned leave no trace at all, so it is
  // renamed instead and the two sit next to each other in the trail.
  const RENAMED: Record<string, string> = { intent_create: 'intent_draft' };
  for (const e of assignmentEvents) {
    if (DUPLICATES_A_TABLE.has(e.eventType)) continue;
    const p = (e.payload as Record<string, unknown>) ?? {};
    raw.push({
      at: iso(e.createdAt)!,
      source: 'event',
      kind: RENAMED[e.eventType] ?? e.eventType,
      intentId: typeof p.intentId === 'number' ? p.intentId : null,
      messageId: typeof p.messageId === 'number' ? p.messageId : null,
      detail: describeEvent(e.eventType, p),
      payload: p,
      assignmentId: e.assignmentId,
    });
  }

  // Snapshot diffs — the spine of the SCORE record.
  const byAssignment = new Map<string, typeof versions>();
  for (const v of versions) {
    const list = byAssignment.get(v.assignmentId) ?? [];
    list.push(v);
    byAssignment.set(v.assignmentId, list);
  }
  for (const [assignmentId, list] of byAssignment) {
    let prev: unknown = null;
    for (const v of list) {
      for (const d of diffSnapshots(prev, v.snapshot, (v.summary ?? {}) as Summary)) {
        raw.push({
          at: iso(v.createdAt)!,
          source: 'snapshot',
          kind: d.kind,
          intentId: d.intentId,
          messageId: (v.summary as Summary)?.messageId ?? null,
          detail: `v${v.versionNo} ${d.detail}`.trim(),
          payload: { versionNo: v.versionNo, summary: v.summary },
          assignmentId,
        });
      }
      prev = v.snapshot;
    }
  }

  for (const r of ruleRows) {
    // `seed` versions are written when the clone is provisioned — the master's
    // base prompt copied onto each type root, before the participant arrives.
    if (r.source === 'seed') continue;
    raw.push({
      at: iso(r.createdAt)!,
      source: 'rule',
      kind: 'rule_save',
      intentId: r.intentId,
      messageId: r.anchorMessageId ?? null,
      detail: `v${r.versionNo} · ${r.source}${r.minor ? ' · minor' : ''} · ${(r.rule ?? '').length} chars`,
      payload: { versionNo: r.versionNo, source: r.source, minor: r.minor },
      assignmentId: r.assignmentId,
    });
  }

  for (const p of promptRows) {
    raw.push({
      at: iso(p.createdAt)!,
      source: 'prompt',
      kind: 'prompt_save',
      intentId: null,
      messageId: null,
      detail: `v${p.versionNo} · ${p.prompt.length} chars`,
      payload: { versionNo: p.versionNo, chars: p.prompt.length },
      assignmentId: p.assignmentId,
    });
    if (p.deployedAt) {
      raw.push({
        at: iso(p.deployedAt)!,
        source: 'prompt',
        kind: 'prompt_deploy',
        intentId: null,
        messageId: null,
        detail: `v${p.versionNo}`,
        payload: { versionNo: p.versionNo },
        assignmentId: p.assignmentId,
      });
    }
  }

  for (const d of deployRows) {
    raw.push({
      at: iso(d.createdAt)!,
      source: 'deploy',
      kind: 'deploy',
      intentId: null,
      messageId: null,
      detail: `chat v${d.versionNo}${d.note ? ` · ${d.note}` : ''}`,
      payload: { versionNo: d.versionNo },
      assignmentId: d.assignmentId,
    });
  }

  // Block test — the prediction and the judgement are separate moments.
  for (const a of testRows) {
    const q = bankPos.get(a.bankItemId);
    if (a.guessedAt) {
      raw.push({
        at: iso(a.guessedAt)!,
        source: 'test',
        kind: 'test_predict',
        intentId: a.pointedIntentId ?? null,
        messageId: null,
        detail: `q${q ?? a.bankItemId} · ${a.guess ? 'yes' : 'no'} · pointed ${a.pointedKind ?? '—'}`,
        payload: { bankItemId: a.bankItemId, guess: a.guess, pointedKind: a.pointedKind },
        assignmentId: a.cloneAssignmentId,
      });
    }
    if (a.ratedAt) {
      raw.push({
        at: iso(a.ratedAt)!,
        source: 'test',
        kind: 'test_rate',
        intentId: null,
        messageId: null,
        detail: `q${q ?? a.bankItemId} · ${a.rating}/5${a.whatsOff ? ' · what’s off' : ''}${a.probe ? ' · probed' : ''}`,
        payload: { bankItemId: a.bankItemId, rating: a.rating },
        assignmentId: a.cloneAssignmentId,
      });
    }
  }

  for (const s of surveyRows) {
    raw.push({
      at: iso(s.answeredAt)!,
      source: 'survey',
      kind: 'survey_answer',
      intentId: null,
      messageId: null,
      detail: `${s.itemKey} = ${s.value}`,
      payload: { itemKey: s.itemKey, value: s.value },
      assignmentId: s.cloneAssignmentId,
    });
  }

  raw.sort((a, b) => a.at.localeCompare(b.at));

  /* -- phase timeline & block clocks -------------------------------- */
  const phaseChanges = events
    .filter((e) => e.eventType === 'phase_advance' || e.eventType === 'phase_forced')
    .map((e) => ({
      at: iso(e.createdAt)!,
      to: String((e.payload as { to?: string })?.to ?? ''),
    }));
  const phaseAt = (at: string) => {
    let phase = 'not_started';
    for (const c of phaseChanges) {
      if (c.at <= at) phase = c.to;
      else break;
    }
    return phase;
  };

  const workStart = (block: 1 | 2) =>
    phaseChanges.find((c) => c.to === `block${block}_work`)?.at ?? null;

  const blocks: TrailBlock[] = plan.map((p) => {
    const clone = cloneByDataset.get(p.datasetKey);
    const started = workStart(p.block);
    const mine = clone ? raw.filter((r) => r.assignmentId === clone.assignmentId) : [];
    const tZero = started ?? mine[0]?.at ?? null;
    return {
      block: p.block,
      datasetKey: p.datasetKey,
      condition: clone ? (clone.condition === 'baseline' ? 'baseline' : 'score') : p.condition,
      assignmentId: clone?.assignmentId ?? null,
      startedAt: tZero,
      endedAt: mine.length ? mine[mine.length - 1].at : null,
      tZeroSource: started ? 'phase' : mine.length ? 'first_action' : 'none',
      events: mine.length,
    };
  });
  const zeroByBlock = new Map(blocks.map((b) => [b.block, b.startedAt]));

  /* -- intent titles as of each moment ------------------------------ */
  // Titles change; the trail should read with the name the intent had then.
  const titleAt: { at: string; assignmentId: string; titles: Map<number, string> }[] = [];
  for (const [assignmentId, list] of byAssignment) {
    for (const v of list) {
      titleAt.push({
        at: iso(v.createdAt)!,
        assignmentId,
        titles: new Map([...intentsOf(v.snapshot)].map(([id, i]) => [id, i.title])),
      });
    }
  }
  const titleFor = (assignmentId: string | null, at: string, intentId: number | null) => {
    if (!assignmentId || intentId == null) return null;
    let title: string | null = null;
    for (const t of titleAt) {
      if (t.assignmentId !== assignmentId) continue;
      if (t.at > at) break;
      title = t.titles.get(intentId) ?? title;
    }
    // Fall back to the earliest name we ever saw — better than nothing for an
    // event that precedes the first snapshot.
    if (!title) {
      for (const t of titleAt) {
        if (t.assignmentId === assignmentId && t.titles.has(intentId)) {
          title = t.titles.get(intentId)!;
          break;
        }
      }
    }
    return title;
  };

  /* -- assemble ----------------------------------------------------- */
  const trailEvents: TrailEvent[] = raw.map((r, i) => {
    const where = r.assignmentId ? blockOf.get(r.assignmentId) ?? null : null;
    const zero = where ? zeroByBlock.get(where.block) ?? null : null;
    return {
      seq: i + 1,
      at: r.at,
      tBlock:
        zero && r.at >= zero
          ? Math.round((new Date(r.at).getTime() - new Date(zero).getTime()) / 1000)
          : null,
      block: where?.block ?? null,
      condition: where?.condition ?? null,
      phase: phaseAt(r.at),
      source: r.source,
      kind: r.kind,
      intentId: r.intentId,
      intentTitle: titleFor(r.assignmentId, r.at, r.intentId),
      messageId: r.messageId,
      detail: r.detail,
      payload: r.payload,
    };
  });

  markAdoptedSuggestions(trailEvents);

  const snapshots: TrailSnapshot[] = versions.map((v) => ({
    block: blockOf.get(v.assignmentId)?.block ?? null,
    versionNo: v.versionNo,
    createdAt: iso(v.createdAt)!,
    summary: v.summary,
    snapshot: v.snapshot,
  }));

  const rules: TrailRuleVersion[] = [
    ...ruleRows.map((r) => ({
      block: blockOf.get(r.assignmentId)?.block ?? null,
      kind: 'score_rule' as const,
      intentId: r.intentId,
      versionNo: r.versionNo,
      source: r.source,
      minor: r.minor,
      text: r.rule ?? '',
      createdAt: iso(r.createdAt)!,
      deployedAt: null,
    })),
    ...promptRows.map((p) => ({
      block: blockOf.get(p.assignmentId)?.block ?? null,
      kind: 'baseline_prompt' as const,
      intentId: null,
      versionNo: p.versionNo,
      source: null,
      minor: null,
      text: p.prompt,
      createdAt: iso(p.createdAt)!,
      deployedAt: iso(p.deployedAt),
    })),
  ];

  const final = blocks
    .filter((b) => b.assignmentId)
    .map((b) => {
      if (b.condition === 'baseline') {
        const deployed = promptRows
          .filter((p) => p.assignmentId === b.assignmentId && p.deployedAt)
          .sort((x, y) => (x.versionNo < y.versionNo ? 1 : -1))[0];
        return { block: b.block, condition: b.condition, config: deployed?.prompt ?? null };
      }
      const latest = deployRows
        .filter((d) => d.assignmentId === b.assignmentId)
        .sort((x, y) => y.versionNo - x.versionNo)[0];
      return { block: b.block, condition: b.condition, config: latest?.snapshot ?? null };
    });

  return {
    participant: {
      id: participant.id,
      number: participant.participantNumber,
      cell: cellOf(participant),
      blockOrder: plan.map((p) => p.datasetKey),
      createdAt: iso(participant.createdAt),
      lastLoginAt: iso(participant.lastLoginAt),
    },
    blocks,
    events: trailEvents,
    snapshots,
    rules,
    final,
  };
}

/**
 * Was a suggestion taken?
 *
 * Approximate on purpose. The client never tells the server which candidate it
 * used, so this looks for the next configuration change on the same intent
 * within a minute. Named `adopted_within_60s` wherever it is exported, because
 * a participant who reads a suggestion, thinks, and edits two minutes later
 * will be counted as having declined it.
 */
const ADOPT_WINDOW_S = 60;

function markAdoptedSuggestions(events: TrailEvent[]): void {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e.kind.startsWith('suggest_')) continue;
    const t0 = new Date(e.at).getTime();
    let adoptedBy: number | null = null;
    for (let j = i + 1; j < events.length; j++) {
      const n = events[j];
      if ((new Date(n.at).getTime() - t0) / 1000 > ADOPT_WINDOW_S) break;
      const isChange =
        n.source === 'snapshot' || n.kind === 'rule_save' || n.kind.startsWith('pin_');
      if (!isChange) continue;
      if (e.intentId != null && n.intentId != null && n.intentId !== e.intentId) continue;
      adoptedBy = n.seq;
      break;
    }
    e.payload = { ...(e.payload ?? {}), adopted_within_60s: adoptedBy !== null, adoptedBy };
  }
}

/** One line per event kind, for the CSV column a human reads first. */
function describeEvent(kind: string, p: Record<string, unknown>): string | null {
  const n = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null);
  switch (kind) {
    case 'pin_set':
      return `${p.verdict}${p.replaced ? ' (replaced)' : ''}${p.hasReason ? ' · with reason' : ''}`;
    case 'pin_remove':
      return `withdrew ${p.verdictWas ?? '?'}`;
    case 'pin_remove_all':
      return `${n('count') ?? 0} withdrawn`;
    case 'pin_retire':
      return `${n('count') ?? 0} retired`;
    case 'rule_apply':
      return `v${p.versionNo} on ${n('messageCount') ?? 0} question(s)`;
    case 'rule_revert':
      return `to v${p.toVersionNo} · dropped ${(p.deletedVersions as unknown[] | undefined)?.length ?? 0}`;
    case 'revert':
      return `to v${p.toVersionNo} · dropped ${(p.deletedVersions as unknown[] | undefined)?.length ?? 0}`;
    case 'suggest_intents':
    case 'suggest_rewrite_intents':
    case 'suggest_reasons':
      return `${n('count') ?? 0} offered`;
    case 'suggest_fold':
      return `${n('correctionCount') ?? 0} correction(s) → ${n('proposalCount') ?? 0} candidate(s)`;
    case 'rating_run':
      return `${n('processed') ?? 0} question(s)`;
    case 'search_run':
    case 'search_save':
      return typeof p.name === 'string' ? p.name : null;
    case 'set_add':
      return `${n('count') ?? 0} added`;
    default:
      return null;
  }
}
