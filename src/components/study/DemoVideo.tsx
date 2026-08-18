/**
 * One walkthrough segment, embedded (design §5.1).
 *
 * youtube-nocookie.com rather than youtube.com: participants are watching this
 * inside a research session, and the consent form does not cover handing their
 * viewing to an ad profile. `rel=0` keeps the end card from offering unrelated
 * videos — the last thing a session needs is a participant clicking away into
 * a recommendation.
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
        <span className="text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--foreground))]">
          {segment.label}
        </span>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{segment.caption}</span>
      </div>
      {segment.youtubeId ? (
        <div className="relative w-full overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-black aspect-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${segment.youtubeId}?rel=0&modestbranding=1`}
            title={segment.label}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] aspect-video">
          <p className="px-6 text-center text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
            The walkthrough video goes here.
            <br />
            <span className="font-mono text-[10.5px]">
              NEXT_PUBLIC_STUDY_DEMO_{segment.key.toUpperCase()}
            </span>{' '}
            is not set yet.
          </p>
        </div>
      )}
    </div>
  );
}
