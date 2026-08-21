'use client';

/**
 * Pull in a rule already written somewhere else in this configuration.
 *
 * Instructors repeat themselves, and they should be allowed to. "Point them at
 * the assignment sheet rather than guessing" is the right answer to several
 * different kinds of question, and retyping it for each one is not work — it is
 * an opportunity to make the third copy say something slightly different from
 * the first two by accident.
 *
 * Unlike the starter sets beside the definition box, nothing here is offered
 * BY the system: every line in this list is text the participant wrote, still
 * in use somewhere they can see. It copies, it does not link — the two intents
 * are separate afterwards, and editing one leaves the other alone. A live
 * inheritance is a hidden layer, and this version has none.
 *
 * Purely local: the configuration on screen already holds every rule and every
 * count, so opening it reads nothing and costs nothing.
 */
import { useMemo, useState } from 'react';
import PickerPopover from './PickerPopover';

export interface RuleSource {
  /** Which intent carries it — 'root' for the everything-else rule. */
  key: string;
  title: string;
  rule: string;
  /** Questions it currently answers. */
  count: number;
}

interface Entry {
  key: string;
  rule: string;
  /** Everywhere this exact text is in use, in tree order. */
  owners: { title: string; count: number }[];
  count: number;
}

export default function RulePicker({
  sources,
  onPick,
  disabled = false,
}: {
  sources: RuleSource[];
  onPick: (rule: string) => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState<Entry | null>(null);

  // One row per distinct TEXT, not per intent. Nesting seeds a new intent with
  // its parent's rule, so a configuration a few edits old is full of intents
  // sharing one wording, and a list that repeated it once per intent would be
  // mostly the same line.
  const entries = useMemo<Entry[]>(() => {
    const byText = new Map<string, Entry>();
    for (const source of sources) {
      const text = source.rule.trim();
      // An empty rule is a real answer — "send no instructions" — but it is not
      // a thing to copy, and offering it would be offering to do nothing.
      if (!text) continue;
      const found = byText.get(text);
      if (found) {
        found.owners.push({ title: source.title, count: source.count });
        found.count += source.count;
      } else {
        byText.set(text, {
          key: source.key,
          rule: source.rule,
          owners: [{ title: source.title, count: source.count }],
          count: source.count,
        });
      }
    }
    return [...byText.values()];
  }, [sources]);

  // Absent rather than disabled when there is nothing written elsewhere yet:
  // on a fresh configuration this is every intent, and a greyed control they
  // cannot explain is worse than one that is not there.
  if (entries.length === 0) return null;

  const label = (entry: Entry) =>
    entry.owners.length === 1
      ? entry.owners[0].title
      : `${entry.owners[0].title} +${entry.owners.length - 1}`;

  return (
    <PickerPopover
      label="Reuse a rule"
      disabled={disabled}
      listWidth={272}
      tipWidth={304}
      onClose={() => setHovered(null)}
      tip={
        hovered && (
          <>
            <p className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
              In use by
            </p>
            <p className="text-xs font-semibold mb-2">
              {hovered.owners.map((o) => o.title).join(', ')}
            </p>
            {/* The whole rule, because a title cannot tell two rules apart and
                copying the wrong one is the mistake this is meant to prevent. */}
            <pre className="whitespace-pre-wrap font-sans text-2xs leading-relaxed text-[hsl(var(--foreground))]">
              {hovered.rule.trim()}
            </pre>
          </>
        )
      }
    >
      {(close) => (
        <>
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                onPick(entry.rule);
                close();
              }}
              onMouseEnter={() => setHovered(entry)}
              onFocus={() => setHovered(entry)}
              className="flex w-full items-baseline gap-2 py-1 px-2.5 text-left hover:bg-[hsl(var(--muted))]"
            >
              <span className="flex-1 truncate text-xs">{label(entry)}</span>
              <span className="shrink-0 text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
                {entry.count}
              </span>
            </button>
          ))}
          <p className="border-t border-[hsl(var(--border))] px-2.5 py-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
            Copies the text. The two stay separate afterwards.
          </p>
        </>
      )}
    </PickerPopover>
  );
}
