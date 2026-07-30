'use client';

/**
 * Shared question-list ordering — the board's middle column and the Revise
 * "Add example" picker sort the log the same way, with the same dropdown.
 */

export type QuerySortMode = 'participant-asc' | 'participant-desc' | 'recent' | 'oldest';

export function sortQueryRows<
  T extends { queryTimestamp: string; participantToken: string; messageId: number }
>(rows: T[], mode: QuerySortMode): T[] {
  const ts = (r: T) => new Date(r.queryTimestamp).getTime();
  const pc = (a: T, b: T) =>
    a.participantToken.localeCompare(b.participantToken, undefined, { numeric: true, sensitivity: 'base' });
  // Within one student ALWAYS oldest→newest, i.e. Turn 1 → Turn N, whichever
  // way the PID axis runs: the point of a PID sort is reading one student's
  // conversation the way it happened. messageId breaks ties (the imported logs
  // do contain same-timestamp pairs) so the order is fully deterministic —
  // every study participant meets the log in the identical sequence.
  const chrono = (a: T, b: T) => ts(a) - ts(b) || a.messageId - b.messageId;
  const arr = rows.slice();
  switch (mode) {
    case 'participant-desc':
      arr.sort((a, b) => pc(b, a) || chrono(a, b));
      break;
    case 'recent':
      arr.sort((a, b) => ts(b) - ts(a) || b.messageId - a.messageId);
      break;
    case 'oldest':
      arr.sort(chrono);
      break;
    default: // 'participant-asc' — the board's default
      arr.sort((a, b) => pc(a, b) || chrono(a, b));
  }
  return arr;
}

export function SortSelect({
  value,
  onChange,
  className = 'text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]',
}: {
  value: QuerySortMode;
  onChange: (m: QuerySortMode) => void;
  className?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as QuerySortMode)} className={className}>
      {/* Default first: the log is an archive of a finished class, so "newest"
          carries no meaning here — reading it student by student does. */}
      <option value="participant-asc">PID ↑</option>
      <option value="participant-desc">PID ↓</option>
      <option value="recent">Newest</option>
      <option value="oldest">Oldest</option>
    </select>
  );
}
