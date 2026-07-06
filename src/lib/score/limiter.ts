/**
 * Global slot limiter for SCORE batch routes: every LLM call in a batch draws
 * from ONE pool of slots, so utilization stays maximal whether a message needs
 * many calls or one. On release a queued waiter inherits the slot directly
 * (no decrement/increment race).
 */
export function createLimiter(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active < max) {
      active++;
    } else {
      await new Promise<void>((resolve) => waiters.push(resolve)); // slot inherited
    }
    try {
      return await fn();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Shared OpenAI concurrency knob (see the tier guidance in classify/route.ts). */
export const SCORE_CONCURRENCY = (() => {
  const parsed = Number.parseInt(process.env.SCORE_LLM_CONCURRENCY ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(128, parsed) : 32;
})();
