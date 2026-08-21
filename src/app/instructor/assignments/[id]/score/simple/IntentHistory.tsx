'use client';

/**
 * One intent's own history, folded into the card it belongs to.
 *
 * The configuration has a timeline too, but it is the wrong place to ask "what
 * did this say before": by the time it matters you are looking at one intent,
 * and its three edits are scattered among everyone else's. So the version
 * number a participant reads belongs to the intent.
 *
 * It has been three shapes. A dropdown labelled "v2" — missed entirely, because
 * beside two neighbours that say what they hold ("Starter sets", "Reuse a
 * rule") a lone number reads as a status badge rather than something to open.
 * Then a list always open under the buttons — found, but it pushed the boxes it
 * is about off the screen. Now a labelled row that says how many there are,
 * opening onto the list: a heading is hard to mistake for a badge, and a card
 * that is not being rewound stays the height of the thing being edited.
 *
 * A version is the WHEN and the THEN together. They are one thought here, and
 * the same rule text can be right or wrong depending on what it was scoped to,
 * so restoring one without the other would hand back a half-sentence.
 *
 * Picking one puts both texts back in the boxes and stops. It does not take
 * effect until Apply, like everything else on this board — an undo that
 * silently republished would be a fourth verb nobody asked for.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

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

/**
 * How long ago, in the units a 25-minute block is lived in.
 *
 * A clock time asks the reader to subtract; "4m ago" is the answer they were
 * going to work out. Hours only appear if someone leaves a board open far
 * longer than a block.
 */
function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
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
  const [open, setOpen] = useState(false);
  // Relative times go stale on a card left open. One tick a minute is enough
  // for a readout whose smallest unit is a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  // Nothing written here yet — a heading over an empty box is furniture.
  if (versions.length === 0) return null;

  return (
    <div className="border-t border-[hsl(var(--border))] pt-1.5">
      <button
        type="button"
        onClick={() => {
          setNow(Date.now());
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-1 text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        {open ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        Versions
        <span className="tabular-nums font-normal">{versions.length}</span>
      </button>

      {open && (
        // Capped and scrolling: a long history must not push the boxes it is
        // about off the screen.
        <ul className="mt-1 max-h-[9rem] overflow-y-auto rounded border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
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
                  className={`flex w-full items-baseline gap-1.5 px-2 py-1 text-left hover:bg-[hsl(var(--muted))] disabled:opacity-50 ${
                    isCurrent ? 'bg-[hsl(var(--primary))]/5' : ''
                  }`}
                >
                  <span className="shrink-0 text-2xs font-bold tabular-nums text-[hsl(var(--muted-foreground))]">
                    v{version.versionNo}
                  </span>
                  {/* Blank until the model's label arrives, and for good if it
                      never does. Falling back to the time printed it twice on
                      the same row; the number and the time are enough to say
                      which version this is. */}
                  <span className="flex-1 truncate text-xs">{version.name ?? ''}</span>
                  <span className="shrink-0 text-2xs text-[hsl(var(--muted-foreground))]">
                    {isCurrent ? 'current' : ago(version.createdAt, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
