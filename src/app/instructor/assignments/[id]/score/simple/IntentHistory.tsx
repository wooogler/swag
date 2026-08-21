'use client';

/**
 * One intent's own history, listed inside the intent.
 *
 * The configuration has a timeline too, but it is the wrong place to ask "what
 * did this say before": by the time it matters you are looking at one intent,
 * and its three edits are scattered among everyone else's. So the version
 * number a participant reads belongs to the intent.
 *
 * A LIST, under the card's own buttons, rather than a control in the header
 * bar. It was a dropdown labelled "v2" first, and the person who asked for the
 * feature could not find it — beside two neighbours that say what they hold
 * ("Starter sets", "Reuse a rule"), a lone version number reads as a status
 * badge, something the screen is telling you rather than something to open.
 * Laid out, it is the one thing on the card that cannot be mistaken for a
 * label.
 *
 * A version is the WHEN and the THEN together. They are one thought here, and
 * the same rule text can be right or wrong depending on what it was scoped to,
 * so restoring one without the other would hand back a half-sentence.
 *
 * Picking one puts both texts back in the boxes and stops. It does not take
 * effect until Apply, like everything else on this board — an undo that
 * silently republished would be a fourth verb nobody asked for.
 */
export interface IntentVersion {
  id: number;
  sid: number;
  versionNo: number;
  definition: string;
  rule: string;
  title: string;
  name: string | null;
  summary: string | null;
  createdAt: string;
}

export default function IntentHistory({
  versions,
  currentDefinition,
  currentRule,
  onPick,
  disabled = false,
}: {
  versions: IntentVersion[];
  currentDefinition: string;
  currentRule: string;
  onPick: (version: IntentVersion) => void;
  disabled?: boolean;
}) {
  // Nothing written here yet — a heading over an empty box is furniture.
  if (versions.length === 0) return null;

  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="border-t border-[hsl(var(--border))] pt-2">
      <p className="mb-1 text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        Versions
      </p>
      {/* Capped and scrolling: a long history must not push the boxes it is
          about off the screen. */}
      <ul className="max-h-[9rem] overflow-y-auto rounded border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
        {versions.map((version) => {
          const isCurrent =
            version.definition === currentDefinition && version.rule === currentRule;
          return (
            <li key={version.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(version)}
                title="Put this wording back in the boxes"
                className={`w-full px-2 py-1 text-left hover:bg-[hsl(var(--muted))] disabled:opacity-50 ${
                  isCurrent ? 'bg-[hsl(var(--primary))]/5' : ''
                }`}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="shrink-0 text-2xs font-bold tabular-nums text-[hsl(var(--muted-foreground))]">
                    v{version.versionNo}
                  </span>
                  <span className="flex-1 truncate text-xs">
                    {/* Until the model's label arrives — and for good if it
                        never does. A clock is a worse name, not a broken one. */}
                    {version.name ?? clock(version.createdAt)}
                  </span>
                  <span className="shrink-0 text-2xs text-[hsl(var(--muted-foreground))]">
                    {isCurrent ? 'now' : clock(version.createdAt)}
                  </span>
                </span>
                {version.summary && (
                  <span className="block truncate text-2xs text-[hsl(var(--muted-foreground))]">
                    {version.summary}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-2xs text-[hsl(var(--muted-foreground))]">
        Picking one puts it back in the boxes. Apply to make it take effect.
      </p>
    </div>
  );
}
