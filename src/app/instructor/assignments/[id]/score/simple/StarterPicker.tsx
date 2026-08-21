'use client';

/**
 * A place to start a definition from, next to the box it goes in.
 *
 * The hardest part of this screen is the first minute: a log of several hundred
 * questions and an empty "when a question…". This offers the taxonomy's own
 * categories — a whole stage of writing, or one kind of request inside it —
 * with the number of questions in THIS log each one describes.
 *
 * It is a library, not a suggestion. The list is fixed, identical for every
 * participant, in the same order every time, and it does not react to what has
 * been typed or to which question is open. Nothing is generated, ranked or
 * recommended: opening it calls no model, and neither does picking from it,
 * because the counts were worked out when the clone was made.
 *
 * A count of zero is shown as readily as a count of forty. The number says what
 * this category finds in this log, which is a fact about the log — treating a
 * zero as a reason to hide the row would turn a fact into advice.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PickerPopover from './PickerPopover';

export interface StarterItem {
  key: string;
  title: string;
  definition: string;
  description: string;
  count: number;
}

export interface StarterGroup {
  key: string;
  label: string;
  description: string;
  whole: StarterItem;
  items: StarterItem[];
}

export default function StarterPicker({
  api,
  onPick,
  disabled = false,
}: {
  /** Builds a URL for the simple routes, carrying any preview `?view=`. */
  api: (path: string, query?: string) => string;
  onPick: (item: StarterItem) => void;
  disabled?: boolean;
}) {
  const [groups, setGroups] = useState<StarterGroup[] | null>(null);
  const [hovered, setHovered] = useState<StarterItem | null>(null);
  const [everOpened, setEverOpened] = useState(false);

  // Fetched on first open, then kept: the list is the same all session, and a
  // round-trip every time the menu opens would make it feel like it is
  // thinking about something.
  useEffect(() => {
    if (!everOpened || groups) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(api('starters'));
      if (!res.ok || cancelled) return;
      const body = await res.json();
      if (!cancelled) setGroups(body.groups ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, everOpened, groups]);

  return (
    <div onMouseDown={() => setEverOpened(true)}>
      <PickerPopover
        label="Starter sets"
        disabled={disabled}
        listWidth={304}
        tipWidth={272}
        onClose={() => setHovered(null)}
        tip={
          hovered && (
            <>
              <p className="text-xs font-semibold mb-1">{hovered.title}</p>
              <p className="text-2xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                {hovered.description}
              </p>
              <p className="mt-2 border-t border-[hsl(var(--border))] pt-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
                {hovered.count === 1
                  ? '1 question in this course matches it.'
                  : `${hovered.count} questions in this course match it.`}
              </p>
            </>
          )
        }
      >
        {(close) =>
          !groups ? (
            <p className="flex items-center gap-1.5 px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="border-b border-[hsl(var(--border))] last:border-b-0">
                {/* The Type is a row, not a heading: "everything to do with
                    planning" is a thing someone might want one rule for. */}
                <Row
                  item={group.whole}
                  label={group.label}
                  strong
                  onPick={(item) => {
                    onPick(item);
                    close();
                  }}
                  onHover={setHovered}
                />
                {group.items.map((item) => (
                  <Row
                    key={item.key}
                    item={item}
                    inset
                    onPick={(picked) => {
                      onPick(picked);
                      close();
                    }}
                    onHover={setHovered}
                  />
                ))}
              </section>
            ))
          )
        }
      </PickerPopover>
    </div>
  );
}

function Row({
  item,
  label,
  strong = false,
  inset = false,
  onPick,
  onHover,
}: {
  item: StarterItem;
  label?: string;
  strong?: boolean;
  inset?: boolean;
  onPick: (item: StarterItem) => void;
  onHover: (item: StarterItem | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      onMouseEnter={() => onHover(item)}
      onFocus={() => onHover(item)}
      className={`flex w-full items-baseline gap-2 py-1 pr-2.5 text-left hover:bg-[hsl(var(--muted))] ${
        inset ? 'pl-6' : 'pl-2.5'
      }`}
    >
      <span className={`flex-1 truncate text-xs ${strong ? 'font-semibold' : ''}`}>
        {label ?? item.title}
      </span>
      <span className="shrink-0 text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
        {item.count}
      </span>
    </button>
  );
}
