/**
 * One move of the task, marked inside the sentence that states it.
 *
 * MARKING, NOT REWORDING. The task's sentences are §6.2 verbatim because the
 * facilitator says the same ones out loud (§6.1), and a task that arrives in
 * two wordings is two tasks. A mark leaves the words alone, so the screen and
 * the script still agree — it only makes the three moves findable again
 * without re-reading the paragraph they arrive in — which is what the board's
 * briefing is for, once the block is under way.
 *
 * EQUAL WEIGHT, AND THAT IS THE DESIGN. Every move is marked and so is the
 * sentence that says a participant may do as little of any of them as they
 * like. Emphasis is instruction: marking "adjust the setup" while leaving
 * "look through the conversations" plain would tell people to spend the block
 * editing, and how much of the log someone covers versus changes is RQ1's
 * primary measure — it cannot be something the screen leaned on. Nothing here
 * may mark a CRITERION (how many to read, how many to change, what a good rule
 * looks like); only the moves themselves and where they end.
 *
 * Byte-identical in both arms, like everything else in the shell.
 *
 * `mark` rather than a styled span so the emphasis survives being read aloud
 * by a screen reader, and box-decoration-clone so the tint wraps with the
 * phrase instead of opening on one line and closing three lines later.
 *
 * Callers put a sentence-final full stop INSIDE the mark. Left outside it sits
 * beyond the horizontal padding, which reads as a stray floating dot.
 */
export default function TaskGoal({ children }: { children: React.ReactNode }) {
  return (
    <mark className="box-decoration-clone rounded bg-[hsl(var(--primary))]/15 px-1 font-semibold text-[hsl(var(--foreground))]">
      {children}
    </mark>
  );
}
