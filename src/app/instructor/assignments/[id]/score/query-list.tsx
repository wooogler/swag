'use client';

/**
 * Shared question-list ordering — the board's middle column and the Revise
 * "Add example" picker sort the log the same way, with the same dropdown.
 */

export type QuerySortMode = 'recent' | 'oldest' | 'participant-asc' | 'participant-desc';

export function sortQueryRows<T extends { queryTimestamp: string; participantToken: string }>(
  rows: T[],
  mode: QuerySortMode
): T[] {
  const ts = (r: T) => new Date(r.queryTimestamp).getTime();
  const pc = (a: T, b: T) =>
    a.participantToken.localeCompare(b.participantToken, undefined, { numeric: true, sensitivity: 'base' });
  const arr = rows.slice();
  switch (mode) {
    case 'oldest':
      arr.sort((a, b) => ts(a) - ts(b));
      break;
    case 'participant-asc':
      arr.sort((a, b) => pc(a, b) || ts(b) - ts(a));
      break;
    case 'participant-desc':
      arr.sort((a, b) => pc(b, a) || ts(b) - ts(a));
      break;
    default:
      arr.sort((a, b) => ts(b) - ts(a));
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
      <option value="recent">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="participant-asc">PID ↑</option>
      <option value="participant-desc">PID ↓</option>
    </select>
  );
}
