/**
 * The task, on one line, for as long as the block lasts (design §6.2).
 *
 * The start screen states the task once; this is what keeps it from having to
 * be remembered. In the 08-18 pilot the system never said what the task was
 * anywhere on the board, and participants spent the opening minutes working
 * that out — time that comes out of the 25 and shows up as variance that has
 * nothing to do with the condition.
 *
 * Boundary, not criterion: what the activity is and where it ends, never how
 * many conversations to read or how many things to change. How much of the log
 * someone covers is RQ1's primary measure, and a banner that implied a number
 * would quietly answer the question the block is asking.
 *
 * Byte-identical in both arms — it is the shell, and the shell is the thing the
 * two conditions are supposed to share. No countdown, ever (§13 invariant 5).
 */
export default function TaskBanner() {
  return (
    <div className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/60">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-1.5">
        <p className="text-[11.5px] leading-snug text-[hsl(var(--muted-foreground))]">
          <span className="font-semibold text-[hsl(var(--foreground))]">Your task:</span> adjust
          the setup so the chatbot responds the way you want — deploy when you&apos;re ready.
        </p>
      </div>
    </div>
  );
}
