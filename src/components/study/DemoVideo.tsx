/**
 * One walkthrough segment, embedded (design §5.1).
 *
 * youtube-nocookie.com rather than youtube.com: participants are watching this
 * inside a research session, and the consent form does not cover handing their
 * viewing to an ad profile. `rel=0` holds the end card to this channel — the
 * last thing a session needs is a participant clicking away into a
 * recommendation. `playsinline=1` for the same reason on the other side: a
 * player that goes fullscreen by itself takes the screen share with it.
 *
 * The id is parsed, not trusted — see `youtubeId` in study/config. Three
 * states below, and the middle one exists because the value being wrong and
 * the value being missing used to look identical on screen.
 *
 * No autoplay. The facilitator says a sentence first (§6.1), and a player that
 * started on its own would talk over them.
 *
 * Before the films exist the slot says so instead of rendering a dead player,
 * because a broken embed in a live session reads as the study being broken.
 */
import type { DemoSegment } from '@/lib/study/config';

export default function DemoVideo({ segment }: { segment: DemoSegment }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-xs font-bold uppercase tracking-wide text-[hsl(var(--foreground))]">
          {segment.label}
        </span>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{segment.caption}</span>
      </div>
      {segment.youtubeId ? (
        <div className="relative w-full overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-black aspect-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${segment.youtubeId}?rel=0&playsinline=1`}
            title={segment.label}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        </div>
      ) : segment.rawValue ? (
        /* Set, but nothing a video id can be read out of.
         *
         * This case used to mount the iframe anyway. A pasted watch link made
         * the src `…/embed/https://youtu.be/ID`, which is a perfectly valid URL,
         * so the player loaded, asked YouTube for a video called "https:" and
         * showed a blank error — indistinguishable, from the outside, from a
         * broken film. Under a participant's eyes that is the wrong thing to
         * start debugging.
         *
         * Shows the value back, because the fault is almost always visible in
         * it: a whole URL, the Share button's `?si=` tag, a truncated id. */
        <div className="flex items-center justify-center rounded-lg border border-dashed border-amber-400 bg-amber-50 aspect-video">
          <p className="px-6 text-center text-sm text-amber-900 leading-relaxed">
            This walkthrough video cannot be played.
            <br />
            <span className="font-mono text-2xs">{segment.envVar}</span> is set, but no
            YouTube video id could be read from it.
            <br />
            <span className="mt-2 inline-block max-w-full break-all rounded bg-amber-100 px-2 py-1 font-mono text-2xs">
              {segment.rawValue.length > 120
                ? `${segment.rawValue.slice(0, 120)}…`
                : segment.rawValue}
            </span>
            <br />
            <span className="text-2xs">
              A watch link, a share link, or the id on its own all work.
            </span>
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] aspect-video">
          <p className="px-6 text-center text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
            The walkthrough video goes here.
            <br />
            <span className="font-mono text-2xs">{segment.envVar}</span>{' '}
            is not set yet.
          </p>
        </div>
      )}
    </div>
  );
}
