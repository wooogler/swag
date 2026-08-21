/**
 * The walkthrough before a block: the film, then the button that says they are
 * ready (design §5.1).
 *
 * The video slot came back on 08-18. It had been deleted when the tutorial
 * became a live demo, and the pilot sent that decision the other way — a live
 * walkthrough cannot be held constant across sixteen sessions, however tight
 * the script is. So this step plays the film instead of standing in for it.
 *
 * Block 1 gets two segments (the shared screens, then this version), block 2
 * only the version it has not seen. Nothing here names the condition beyond
 * the code name the header already shows.
 *
 * The button is the participant's, not the facilitator's: they press it when
 * they have watched and had their questions answered, which is also what makes
 * the phase move.
 */
import DemoVideo from './DemoVideo';
import PhaseAdvance from './PhaseAdvance';
import type { DemoSegment } from '@/lib/study/config';

export default function TutorialStep({
  title,
  body,
  segments,
  fromPhase,
  buttonLabel,
}: {
  title: string;
  body: string;
  segments: DemoSegment[];
  fromPhase: string;
  buttonLabel: string;
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8">
      <h1 className="text-xl font-semibold mb-2 text-center">{title}</h1>
      <p className="text-base text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed text-center">
        {body}
      </p>

      <div className="space-y-5">
        {segments.map((segment) => (
          <DemoVideo key={segment.key} segment={segment} />
        ))}
      </div>

      <div className="mt-7 flex flex-col items-center">
        <PhaseAdvance from={fromPhase} label={buttonLabel} />
      </div>
    </div>
  );
}
