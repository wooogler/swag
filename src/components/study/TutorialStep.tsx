/**
 * The walkthrough a participant watches before a block.
 *
 * The video slot is empty until the recordings exist (config.TUTORIAL_VIDEOS),
 * and the step still renders: it is what makes the participant stop between
 * blocks, which is when the facilitator explains this block's tools over the
 * shared screen. Nothing here names the condition — a participant is being
 * shown "this part", never SCORE or baseline.
 */
import PhaseAdvance from './PhaseAdvance';

export default function TutorialStep({
  title,
  body,
  videoUrl,
  fromPhase,
  buttonLabel,
}: {
  title: string;
  body: string;
  videoUrl: string | null;
  fromPhase: string;
  buttonLabel: string;
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8">
      <h1 className="text-lg font-semibold mb-2 text-center">{title}</h1>
      <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed text-center">
        {body}
      </p>

      {videoUrl ? (
        <div
          style={{ aspectRatio: "16 / 9" }}
          className="w-full overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-black"
        >
          <iframe
            src={videoUrl}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        </div>
      ) : (
        <div
          style={{ aspectRatio: "16 / 9" }}
          className="w-full rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] flex items-center justify-center"
        >
          <p className="text-xs text-[hsl(var(--muted-foreground))] text-center px-6 leading-relaxed">
            Your facilitator will walk you through this part on the shared screen.
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-col items-center">
        <PhaseAdvance from={fromPhase} label={buttonLabel} />
      </div>
    </div>
  );
}
