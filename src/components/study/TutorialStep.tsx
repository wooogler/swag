/**
 * The pause before a block, where the facilitator demonstrates.
 *
 * Design v2 replaced the tutorial recordings with a live demo (§5), so there is
 * no video slot any more — this step exists to STOP the participant between
 * blocks while the demo happens on the shared screen, and the button is what
 * says they are ready. Nothing here names the condition: a participant is being
 * shown "this part", never SCORE or baseline.
 */
import PhaseAdvance from './PhaseAdvance';

export default function TutorialStep({
  title,
  body,
  fromPhase,
  buttonLabel,
}: {
  title: string;
  body: string;
  fromPhase: string;
  buttonLabel: string;
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8">
      <h1 className="text-lg font-semibold mb-2 text-center">{title}</h1>
      <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed text-center">
        {body}
      </p>

      <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-6 py-5">
        <p className="text-xs text-[hsl(var(--muted-foreground))] text-center leading-relaxed">
          Your facilitator will walk you through this part on the shared screen.
        </p>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <PhaseAdvance from={fromPhase} label={buttonLabel} />
      </div>
    </div>
  );
}
