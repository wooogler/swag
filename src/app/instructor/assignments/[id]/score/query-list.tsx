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

/**
 * "Most different" — farthest from the anchor first, by cosine distance
 * (`similar?anchor=`). Unscored questions sink to the bottom in their given
 * order; with no scores at all it degrades to newest-first, the same fallback
 * the preview's sort dropdown flips to.
 *
 * SHARED so the cross-query preview and the rule workbench's example tabs open
 * on the SAME questions: the workbench seeds its tabs with the first three of
 * this order, which is exactly what the preview lists at the top. Two lists
 * that disagree about which three examples matter is what this prevents.
 */
export function sortByAnchorDistance<
  T extends { queryTimestamp: string; participantToken: string; messageId: number }
>(rows: T[], distances: Record<number, number>): T[] {
  const scored = rows.filter((r) => typeof distances[r.messageId] === 'number');
  if (scored.length === 0) return sortQueryRows(rows, 'recent');
  const unscored = rows.filter((r) => typeof distances[r.messageId] !== 'number');
  scored.sort((a, b) => distances[a.messageId] - distances[b.messageId]);
  return [...scored, ...unscored];
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
