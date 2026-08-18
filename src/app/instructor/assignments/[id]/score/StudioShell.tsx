'use client';

/**
 * The Chatbot Studio page frame: one header bar, one main area.
 *
 * A workbench takes over the whole page, so it takes over the header too. While
 * one is open the studio header (assignment, Deploy, account) steps aside and
 * the workbench renders its OWN bar there — otherwise the page carries two back
 * buttons (out of the workbench, out of the studio) and a row of controls that
 * do not apply to what is on screen.
 *
 * The handover is a portal rather than lifted state: the bar keeps living inside
 * its workbench, so its buttons stay wired to that workbench's own state and
 * re-render with it, while the DOM node sits up in the header.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface HeaderSlot {
  /** The header's portal target — null for the first render after mount. */
  el: HTMLElement | null;
  /** Hide the studio header while a workbench owns the bar. */
  claim: (claimed: boolean) => void;
}

const HeaderSlotContext = createContext<HeaderSlot | null>(null);

/** Null outside the studio shell — callers then render their bar inline. */
export function useHeaderSlot(): HeaderSlot | null {
  return useContext(HeaderSlotContext);
}

export default function StudioShell({
  header,
  banner,
  children,
}: {
  header: ReactNode;
  /**
   * A strip above the header that a workbench CANNOT claim.
   *
   * The study's task banner lives here rather than in `header` because a
   * participant spends most of the block inside a workbench, and a workbench
   * takes the header over — so a banner in there would vanish exactly when it
   * is doing its job (design §6.2: it is what keeps the task from having to be
   * remembered).
   */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [claimed, setClaimed] = useState(false);
  const slot = useMemo<HeaderSlot>(() => ({ el, claim: setClaimed }), [el]);

  return (
    <HeaderSlotContext.Provider value={slot}>
      {banner}
      <header className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Always mounted so the portal target exists before any workbench
              opens — a target created on demand would cost the bar a frame. */}
          <div ref={setEl} className={claimed ? undefined : 'hidden'} />
          {!claimed && header}
        </div>
      </header>

      <main className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-6 flex-1 flex flex-col min-h-0">
        {children}
      </main>
    </HeaderSlotContext.Provider>
  );
}
