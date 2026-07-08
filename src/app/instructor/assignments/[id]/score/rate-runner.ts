'use client';

/**
 * SCORE v6 — sharded parallel rate runner.
 *
 * Applying a new/edited intent to the whole log used to be a SEQUENTIAL loop of
 * ~40-message POSTs (one round trip at a time), so a few-hundred-message log
 * took 45-60s while the account's ~500 req/s headroom sat idle. This fans the
 * work out into `shardCount` POSTs dispatched AT ONCE, each handling a disjoint
 * `messageId % shardCount` slice (the server enforces the partition), so the
 * whole log is rated in roughly one wave of the concurrency pool.
 *
 * Shared by the New Intent flow (scoped to one intent) and the "Re-rate all"
 * control (force). Progress is aggregated across shards; any shard failure is
 * surfaced while the shards that succeeded keep their landed work.
 */

export interface RateProgress {
  rated: number;
  total: number;
  failed: number;
}

interface ShardedRateOptions {
  assignmentId: string;
  model: string;
  /** Scope the run to these intents (New Intent flow). Omit to rate all active intents. */
  intentIds?: number[];
  /** Force a full re-rate (mark this shard's rows stale first). */
  force?: boolean;
  /** Rough size of the log — used only to pick a sensible shard count. */
  estimatedTotal: number;
  signal: AbortSignal;
  /** mountedRef.current && !signal.aborted, supplied by the caller. */
  isLive: () => boolean;
  onProgress: (p: RateProgress) => void;
}

// Cap the fan-out at 6: browsers allow ~6 concurrent connections per origin over
// HTTP/1.1 (local dev), so more shards would just queue there. Over HTTP/2
// (prod) they'd all go, but 6 already lands a few-hundred-message log in ~one
// wave given the per-POST concurrency pool. PER_SHARD_TARGET sizes the count so
// each shard is roughly one pool-wave of messages.
const MAX_SHARDS = 6;
const PER_SHARD_TARGET = 40;
// Messages per shard POST. Deliberately SMALLER than one full slice: a POST
// only reports progress when it returns, and one hung LLM call holds its whole
// batch hostage (a 5-minute straggler was observed freezing an Apply at ~90%).
// Smaller batches → the bar moves every few seconds and a straggler blocks ≤48
// messages, not a whole slice. The shard loop repeats until the slice drains.
const PER_SHARD_LIMIT = 48;

function pickShardCount(estimatedTotal: number): number {
  const byWork = Math.ceil(Math.max(1, estimatedTotal) / PER_SHARD_TARGET);
  return Math.max(1, Math.min(MAX_SHARDS, byWork));
}

export async function runShardedRate(opts: ShardedRateOptions): Promise<RateProgress> {
  const { assignmentId, model, intentIds, force, estimatedTotal, signal, isLive, onProgress } = opts;
  const shardCount = pickShardCount(estimatedTotal);

  // Latest per-shard snapshot; the aggregate is their sum. `rated`/`total` from
  // the server are cumulative-for-the-shard, so we overwrite (not add) per shard.
  const ratedByShard = new Array<number>(shardCount).fill(0);
  const totalByShard = new Array<number>(shardCount).fill(0);
  let failed = 0;

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const emit = () => {
    if (isLive()) onProgress({ rated: sum(ratedByShard), total: sum(totalByShard), failed });
  };

  async function runShard(shardIndex: number): Promise<void> {
    let first = true;
    while (true) {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(intentIds ? { intentIds } : {}),
          force: first && !!force,
          limit: PER_SHARD_LIMIT,
          shardIndex,
          shardCount,
          model,
        }),
        signal,
      });
      const d = await res.json().catch(() => ({}));
      if (!isLive()) return;
      if (!res.ok) throw new Error(typeof d?.message === 'string' ? d.message : 'Rating failed.');
      ratedByShard[shardIndex] = d.rated ?? 0;
      totalByShard[shardIndex] = d.total ?? 0;
      failed += d.failed ?? 0;
      emit();
      if ((d.remaining ?? 0) <= 0 || (d.processed ?? 0) === 0) return;
      if ((d.succeeded ?? 0) === 0) {
        throw new Error('Rating stalled — LLM calls are failing. Check the server logs.');
      }
      first = false;
    }
  }

  // Wait for every shard (allSettled, not all) so a single failure doesn't leave
  // sibling POSTs running detached — the ones that succeeded still land their
  // rows. Surface the first failure once everything has quiesced.
  const results = await Promise.allSettled(
    Array.from({ length: shardCount }, (_, i) => runShard(i))
  );
  const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (firstError && isLive()) throw firstError.reason;

  return { rated: sum(ratedByShard), total: sum(totalByShard), failed };
}
