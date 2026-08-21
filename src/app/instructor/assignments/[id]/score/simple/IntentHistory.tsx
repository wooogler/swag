'use client';

/**
 * One intent's own history, inside the intent.
 *
 * The configuration has a timeline of its own, but it is the wrong place to
 * ask "what did this say before": by the time it matters you are looking at
 * one intent, and its three edits are scattered among everyone else's. So the
 * version number a participant reads belongs to the intent, and lives where
 * the intent is being edited.
 *
 * A version is the WHEN and the THEN together. They are one thought here, and
 * the same rule text can be right or wrong depending on what it was scoped to,
 * so restoring one without the other would hand back a half-sentence.
 *
 * Picking one puts both texts back in the editor and stops. It does not take
 * effect until Apply, like everything else on this board — an undo that
 * silently republished would be a fourth verb nobody asked for.
 */
import { useState } from 'react';
import PickerPopover from './PickerPopover';

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
  /** The everything-else rule and the baseline document have no When. */
  showDefinition = true,
}: {
  versions: IntentVersion[];
  currentDefinition: string;
  currentRule: string;
  onPick: (version: IntentVersion) => void;
  disabled?: boolean;
  showDefinition?: boolean;
}) {
  const [hovered, setHovered] = useState<IntentVersion | null>(null);

  // Absent until there is a past to look at. One version is the present, and
  // a history containing only what is already on screen is a control that does
  // nothing.
  if (versions.length <= 1) return null;

  const isCurrent = (v: IntentVersion) =>
    v.definition === currentDefinition && v.rule === currentRule;

  return (
    <PickerPopover
      // Named, not numbered. Its two neighbours say what they hold — "Starter
      // sets", "Reuse a rule" — and a lone "v2" beside them reads as a status
      // badge rather than as the way back to what this intent used to say. It
      // was missed by the person who asked for it, which is the only test of a
      // control that matters.
      label={`Version ${versions[0].versionNo}`}
      title="Earlier versions of this intent — its when and then together"
      disabled={disabled}
      listWidth={264}
      tipWidth={312}
      onClose={() => setHovered(null)}
      tip={
        hovered && (
          <>
            <p className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
              v{hovered.versionNo} ·{' '}
              {new Date(hovered.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            {hovered.summary && (
              <p className="text-2xs leading-relaxed text-[hsl(var(--muted-foreground))] mb-2">
                {hovered.summary}
              </p>
            )}
            {showDefinition && (
              <>
                <p className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  When
                </p>
                <pre className="whitespace-pre-wrap font-sans text-2xs leading-relaxed mb-2">
                  {hovered.definition.trim() || '(empty)'}
                </pre>
              </>
            )}
            <p className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Then
            </p>
            <pre className="whitespace-pre-wrap font-sans text-2xs leading-relaxed">
              {hovered.rule.trim() || '(empty)'}
            </pre>
          </>
        )
      }
    >
      {(close) => (
        <>
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              onClick={() => {
                onPick(version);
                close();
              }}
              onMouseEnter={() => setHovered(version)}
              onFocus={() => setHovered(version)}
              className="flex w-full items-baseline gap-2 py-1 px-2.5 text-left hover:bg-[hsl(var(--muted))]"
            >
              <span className="shrink-0 text-2xs font-bold tabular-nums text-[hsl(var(--muted-foreground))]">
                v{version.versionNo}
              </span>
              <span className="flex-1 truncate text-xs">
                {/* Until the model's label arrives — and for good if it never
                    does. A clock is a worse name, not a broken one. */}
                {version.name ??
                  new Date(version.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
              </span>
              {isCurrent(version) && (
                <span className="shrink-0 text-2xs text-[hsl(var(--muted-foreground))]">now</span>
              )}
            </button>
          ))}
          <p className="border-t border-[hsl(var(--border))] px-2.5 py-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
            Puts it back in the boxes. Apply to make it take effect.
          </p>
        </>
      )}
    </PickerPopover>
  );
}
