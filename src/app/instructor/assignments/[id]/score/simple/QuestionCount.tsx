'use client';

/**
 * A number of this course's questions, wherever one is shown.
 *
 * Four places show one — a row in the tree, a row in an intent's history, a
 * starter set, a rule offered for reuse — and each showed a bare figure, which
 * left the reader to work out what was being counted and, worse, to assume the
 * same thing everywhere. The pill is the shared part: this is a count of
 * questions, in the log you are looking at.
 *
 * WHAT it counts still differs, and the title says so. A tree row is
 * OWNERSHIP — where a question ends up, after the intents above have taken
 * theirs, which is why those numbers add up to the log. A history row is
 * MATCHES — how many questions that wording describes, whatever sits above it,
 * because the question a history answers is about the words on the row. The
 * two agree until one intent starts taking questions another one also
 * describes, and then they must not look like the same number.
 *
 * So `title` is required. A count with nothing said about it is what this
 * component exists to stop.
 */
import { MessageSquare } from 'lucide-react';

/**
 * "1 question goes here" / "12 questions go here".
 *
 * The verb inflects too, which is why the caller hands over both halves
 * instead of a plural 's' — the counts here run from 0 to the whole log, and
 * "1 question match it" was on the screen.
 */
export function questionsThat(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 question ${singular}` : `${count} questions ${plural}`;
}

export default function QuestionCount({
  value,
  title,
  /** The tree's own rows, which are read at a glance and from further away. */
  strong = false,
}: {
  value: number;
  title: string;
  strong?: boolean;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 inline-flex items-center justify-center gap-1 rounded-full bg-[hsl(var(--muted))] px-1.5 py-0.5 tabular-nums ${
        strong
          ? 'min-w-[2.5rem] text-xs font-semibold text-[hsl(var(--foreground))]'
          : 'min-w-[2.25rem] text-2xs font-medium text-[hsl(var(--muted-foreground))]'
      }`}
    >
      <MessageSquare aria-hidden className="w-3 h-3 shrink-0 opacity-50" />
      {value}
    </span>
  );
}
