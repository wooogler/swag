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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';

/** Kept in px because the panel is measured and placed, not laid out. */
const LIST_WIDTH = 304;
const TIP_WIDTH = 272;
const GAP = 6;

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
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<StarterGroup[] | null>(null);
  const [hovered, setHovered] = useState<StarterItem | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [at, setAt] = useState<{ top: number; left: number; flip: boolean } | null>(null);

  /**
   * Anchored to the viewport rather than to the button's own box.
   *
   * The editor it sits in is inside a scrolling column, and a panel positioned
   * within that gets clipped at the column's edge — which is exactly where the
   * description has to go. Measuring instead lets the pair sit over the
   * neighbouring column for as long as it is open, and puts the description on
   * the other side when there is no room on the right.
   */
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, rect.right - LIST_WIDTH);
    setAt({
      top: rect.bottom + 4,
      left,
      flip: left + LIST_WIDTH + GAP + TIP_WIDTH > window.innerWidth - 8,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    // Capture: the column this lives in scrolls, and that scroll does not
    // bubble.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Fetched on first open, then kept: the list is the same all session, and a
  // round-trip every time the menu opens would make it feel like it is
  // thinking about something.
  useEffect(() => {
    if (!open || groups) return;
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
  }, [api, groups, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (item: StarterItem) => {
    onPick(item);
    setOpen(false);
    setHovered(null);
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 py-0.5 text-2xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
      >
        Starter sets
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && at && (
        <div className="fixed z-50" style={{ top: at.top, left: at.left }}>
          <div className={`flex items-start gap-1.5 ${at.flip ? 'flex-row-reverse' : ''}`}>
            <div
              style={{ width: LIST_WIDTH }}
              className="shrink-0 max-h-[26rem] overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
            >
              {!groups ? (
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
                      onPick={pick}
                      onHover={setHovered}
                    />
                    {group.items.map((item) => (
                      <Row key={item.key} item={item} onPick={pick} onHover={setHovered} inset />
                    ))}
                  </section>
                ))
              )}
            </div>

            {/* To the side rather than underneath, so the list does not move
                while it is being read. */}
            {hovered && (
              <div
                style={{ width: TIP_WIDTH }}
                className="shrink-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 shadow-lg"
              >
                <p className="text-xs font-semibold mb-1">{hovered.title}</p>
                <p className="text-2xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                  {hovered.description}
                </p>
                <p className="mt-2 border-t border-[hsl(var(--border))] pt-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
                  {hovered.count === 1
                    ? '1 question in this course matches it.'
                    : `${hovered.count} questions in this course match it.`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
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
