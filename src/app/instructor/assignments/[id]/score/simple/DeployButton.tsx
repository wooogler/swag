'use client';

/**
 * Deploy — the final save, in the header where the full version's is.
 *
 * The briefing has always ended "when you feel it's ready, deploy it", and
 * until now the board had no such verb: there was Save, and then an "I'm done"
 * that quietly treated the newest save as the answer. Which save you meant was
 * never asked.
 *
 * So this is one press that saves what is in effect and stands behind it. It
 * is not a second copy of the configuration going live somewhere — the board
 * has always answered from the newest write — it is the declaration that turns
 * "the last one I happened to save" into "this one".
 *
 * Three states, and the sentence is the difference between them: nothing
 * deployed yet, this is deployed, and this was deployed but there has been
 * work since. The third is the one worth being loud about, because it is the
 * one where what they are looking at is not what the next step will read.
 */
import { useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';

export default function SimpleDeployButton({
  assignmentId,
  view,
  deployedVersionNo,
  currentVersionNo,
  dirty,
}: {
  assignmentId: string;
  view: string | null;
  deployedVersionNo: number | null;
  /** The newest write, saved or applied. */
  currentVersionNo: number | null;
  /** Something is in effect that the newest save does not carry. */
  dirty: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const behind = deployedVersionNo != null && (dirty || deployedVersionNo !== currentVersionNo);
  const live = deployedVersionNo != null && !behind;

  const deploy = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/simple/deploy${
          view ? `?view=${view}` : ''
        }`,
        { method: 'POST' }
      );
      if (res.ok) window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline text-2xs text-[hsl(var(--muted-foreground))]">
        {live
          ? `Deployed v${deployedVersionNo}`
          : behind
            ? `Changed since v${deployedVersionNo}`
            : 'Not deployed yet'}
      </span>
      <button
        onClick={() => void deploy()}
        disabled={busy || live || currentVersionNo == null}
        title={
          live
            ? 'This is already what you deployed'
            : 'Save what is in effect and make it the setup you stand behind'
        }
        className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
        {behind ? 'Deploy again' : 'Deploy'}
      </button>
    </div>
  );
}
