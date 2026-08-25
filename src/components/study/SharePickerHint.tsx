'use client';

/**
 * A picture of the dialog the browser is about to show, with the right answer
 * marked.
 *
 * The participant is about to meet Chrome's "Choose what to share" window,
 * which is a grid of near-identical grey thumbnails under two tabs, and they
 * have to pick one correctly with nobody in the room to ask. Prose does not
 * carry this — "choose Window, then the one showing this page" is exact and
 * still leaves them looking for something they have never seen. A small mock of
 * the actual dialog, with the tab and the thumbnail highlighted, means the
 * screen in front of them is one they already recognise.
 *
 * It is a DRAWING, not a screenshot: a screenshot of one Chrome version on one
 * OS goes stale and starts lying, and a picture that disagrees with what the
 * participant sees is worse than none. This is deliberately schematic — the
 * shapes and the words match, the chrome does not pretend to.
 *
 * The two tabs shown are the two they will get. `monitorTypeSurfaces:
 * 'exclude'` (recorder.ts) keeps "Entire Screen" out of the real dialog, so it
 * is not drawn here either.
 */
export default function SharePickerHint({ compact = false }: { compact?: boolean }) {
  return (
    <figure
      className={`mx-auto ${compact ? 'max-w-sm' : 'max-w-md'} rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3`}
    >
      <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
        <p className="border-b border-[hsl(var(--border))] px-3 py-2 text-[11px] font-semibold text-[hsl(var(--foreground))]">
          Choose what to share
        </p>

        {/* The tab strip, with the one they want already active. */}
        <div className="flex gap-3 border-b border-[hsl(var(--border))] px-3 pt-2 text-[11px]">
          <span className="pb-1.5 text-[hsl(var(--muted-foreground))]">Chrome Tab</span>
          <span className="-mb-px border-b-2 border-[hsl(var(--primary))] pb-1.5 font-semibold text-[hsl(var(--primary))]">
            Window
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 p-3">
          {/* The one to pick: outlined, ticked, and captioned with what makes
              it recognisable — it is the window this very page is in. */}
          <div className="relative">
            <div className="flex h-12 items-center justify-center rounded border-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10">
              <span className="text-[9px] font-semibold text-[hsl(var(--primary))]">
                this page
              </span>
            </div>
            <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[12px] font-bold leading-none text-white">
              ✓
            </span>
          </div>
          {/* Whatever else they have open. Drawn blank on purpose: naming
              anything here (Zoom, Mail) would make the picture wrong for
              everyone who does not have it. */}
          <div className="h-12 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]" />
          <div className="h-12 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]" />
        </div>

        <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] px-3 py-2">
          <span className="rounded border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            Cancel
          </span>
          <span className="rounded bg-[hsl(var(--primary))] px-2 py-0.5 text-[10px] font-semibold text-white">
            Share
          </span>
        </div>
      </div>

      <figcaption className="mt-2 text-center text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
        Pick <span className="font-semibold text-[hsl(var(--foreground))]">Window</span>, then the
        one showing this page, then{' '}
        <span className="font-semibold text-[hsl(var(--foreground))]">Share</span>.
      </figcaption>
    </figure>
  );
}
