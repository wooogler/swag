'use client';

/**
 * The shell both pickers share: a small button, a list under it, and a pane
 * beside the list describing whatever is hovered.
 *
 * It exists because the placement is the fiddly part, and getting it wrong is
 * invisible until someone opens the menu. The editors live inside a scrolling
 * column, so a popover laid out in place gets clipped at exactly the edge the
 * description has to cross. This measures the button against the VIEWPORT
 * instead, which lets the pair sit over the neighbouring column for as long as
 * it is open, and flips the description to the other side when the right runs
 * out of room.
 *
 * Two of these would have drifted apart at the first fix.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

const GAP = 6;

export default function PickerPopover({
  label,
  title,
  disabled = false,
  listWidth,
  tipWidth,
  tip,
  onClose,
  children,
}: {
  label: string;
  /** What the control is for, for anyone who hovers before clicking. */
  title?: string;
  disabled?: boolean;
  listWidth: number;
  tipWidth: number;
  /** Shown beside the list — the caller decides when there is something to say. */
  tip?: ReactNode;
  /** Called when the popover closes, so the caller can drop its hover state. */
  onClose?: () => void;
  /** The list. `close` dismisses the popover, which a pick should do. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number; flip: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, rect.right - listWidth);
    setAt({
      top: rect.bottom + 4,
      left,
      flip: left + listWidth + GAP + tipWidth > window.innerWidth - 8,
    });
  }, [listWidth, tipWidth]);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [close, open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 py-0.5 text-2xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
      >
        {label}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && at && (
        <div className="fixed z-50" style={{ top: at.top, left: at.left }}>
          <div className={`flex items-start gap-1.5 ${at.flip ? 'flex-row-reverse' : ''}`}>
            <div
              style={{ width: listWidth }}
              className="shrink-0 max-h-[26rem] overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
            >
              {children(close)}
            </div>
            {tip && (
              <div
                style={{ width: tipWidth }}
                className="shrink-0 max-h-[26rem] overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 shadow-lg"
              >
                {tip}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
