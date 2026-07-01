'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

type TooltipPlace = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  id: string;
  place?: TooltipPlace;
  className?: string;
  style?: CSSProperties;
  noArrow?: boolean;
  opacity?: number;
}

interface TooltipState {
  visible: boolean;
  anchor: HTMLElement | null;
  content: string;
  html: string;
}

const DEFAULT_TOOLTIP_CLASS =
  'pointer-events-none fixed z-50 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-2 py-1 text-xs text-[hsl(var(--popover-foreground))] shadow-md';

const getAnchorForId = (target: EventTarget | null, id: string): HTMLElement | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(`[data-tooltip-id="${id}"]`);
};

interface Placement {
  left: number;
  top: number;
  place: TooltipPlace;
  arrow: CSSProperties;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

// Viewport-aware placement: pick the requested side, flip to the opposite side
// if there isn't room, then clamp the box inside the viewport so it never
// renders off-screen. The arrow is re-pointed at the anchor center after clamp.
function computePlacement(rect: DOMRect, w: number, h: number, requested: TooltipPlace): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const M = VIEWPORT_MARGIN;
  const G = ANCHOR_GAP;

  let place = requested;
  if (requested === 'top' && rect.top - G - h < M) place = 'bottom';
  else if (requested === 'bottom' && rect.bottom + G + h > vh - M) place = 'top';
  else if (requested === 'left' && rect.left - G - w < M) place = 'right';
  else if (requested === 'right' && rect.right + G + w > vw - M) place = 'left';

  let left: number;
  let top: number;
  if (place === 'top' || place === 'bottom') {
    left = rect.left + rect.width / 2 - w / 2;
    top = place === 'top' ? rect.top - G - h : rect.bottom + G;
  } else {
    top = rect.top + rect.height / 2 - h / 2;
    left = place === 'left' ? rect.left - G - w : rect.right + G;
  }

  left = Math.max(M, Math.min(left, vw - w - M));
  top = Math.max(M, Math.min(top, vh - h - M));

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let arrow: CSSProperties;
  if (place === 'top' || place === 'bottom') {
    const ax = Math.max(8, Math.min(cx - left, w - 8));
    arrow =
      place === 'top'
        ? { bottom: -4, left: ax, transform: 'translateX(-50%) rotate(45deg)' }
        : { top: -4, left: ax, transform: 'translateX(-50%) rotate(45deg)' };
  } else {
    const ay = Math.max(8, Math.min(cy - top, h - 8));
    arrow =
      place === 'left'
        ? { right: -4, top: ay, transform: 'translateY(-50%) rotate(45deg)' }
        : { left: -4, top: ay, transform: 'translateY(-50%) rotate(45deg)' };
  }
  return { left, top, place, arrow };
}

export function Tooltip({
  id,
  place = 'top',
  className = '',
  style,
  noArrow = false,
  opacity = 1,
}: TooltipProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<TooltipState>({
    visible: false,
    anchor: null,
    content: '',
    html: '',
  });
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const hideTooltip = () => {
    setState((prev) => {
      if (!prev.visible) return prev;
      return { ...prev, visible: false, anchor: null, content: '', html: '' };
    });
    setAnchorRect(null);
  };

  useEffect(() => {
    setMounted(true);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const scheduleRectUpdate = (anchor: HTMLElement) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        setAnchorRect(anchor.getBoundingClientRect());
      });
    };

    const showTooltip = (anchor: HTMLElement) => {
      const nextContent = anchor.getAttribute('data-tooltip-content') ?? '';
      const nextHtml = anchor.getAttribute('data-tooltip-html') ?? '';

      if (!nextContent && !nextHtml) {
        hideTooltip();
        return;
      }

      setState((prev) => {
        if (
          prev.visible &&
          prev.anchor === anchor &&
          prev.content === nextContent &&
          prev.html === nextHtml
        ) {
          return prev;
        }
        return {
          visible: true,
          anchor,
          content: nextContent,
          html: nextHtml,
        };
      });
      scheduleRectUpdate(anchor);
    };

    const handlePointerOver = (event: Event) => {
      const anchor = getAnchorForId(event.target, id);
      if (!anchor) {
        return;
      }
      showTooltip(anchor);
    };

    const handlePointerOut = (event: Event) => {
      const currentAnchor = state.anchor;
      if (!currentAnchor) {
        return;
      }
      const relatedTarget = (event as MouseEvent).relatedTarget;
      if (relatedTarget instanceof Element && currentAnchor.contains(relatedTarget)) {
        return;
      }
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const anchor = getAnchorForId(event.target, id);
      if (!anchor) {
        return;
      }
      showTooltip(anchor);
    };

    const handleFocusOut = () => {
      hideTooltip();
    };

    const handleViewportChange = () => {
      if (state.visible && state.anchor) {
        scheduleRectUpdate(state.anchor);
      }
    };

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [id, state.anchor, state.visible]);

  // Measure the rendered tooltip and place it inside the viewport. Runs before
  // paint, so the corrected position is what the user sees (no flash). Recompute
  // whenever the anchor moves (scroll/resize) or the content changes.
  useLayoutEffect(() => {
    if (!state.visible || !anchorRect || !tooltipRef.current) {
      return;
    }
    const el = tooltipRef.current;
    setPlacement(computePlacement(anchorRect, el.offsetWidth, el.offsetHeight, place));
  }, [state.visible, anchorRect, state.content, state.html, place]);

  if (!mounted || !state.visible || !anchorRect) {
    return null;
  }

  // Until measured, render off-screen + transparent so it is measurable but unseen.
  const ready = placement !== null;

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className={`${DEFAULT_TOOLTIP_CLASS} ${className}`.trim()}
      style={{
        left: ready ? placement.left : -9999,
        top: ready ? placement.top : -9999,
        transform: 'none',
        ...style,
        opacity: ready ? opacity : 0,
      }}
    >
      {!noArrow && ready && (
        <span
          aria-hidden="true"
          className="absolute block h-2 w-2 border-l border-t border-[hsl(var(--border))] bg-[hsl(var(--popover))]"
          style={placement.arrow}
        />
      )}
      {state.html ? (
        <div dangerouslySetInnerHTML={{ __html: state.html }} />
      ) : (
        <div>{state.content}</div>
      )}
    </div>,
    document.body
  );
}
