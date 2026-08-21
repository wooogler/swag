'use client';

/**
 * The deploy control a study participant gets, in BOTH conditions.
 *
 * One component rather than one per arm, because the arms are supposed to
 * differ in exactly one thing — how the instructor expresses intent — and
 * nothing else. SCORE's researcher-facing control (DeployControls) carries a
 * version dropdown and a review modal with a version-name field; the baseline
 * has a single button. That gap is a confound: it hands one arm a way to
 * inspect, name and revisit what it published, and measures the difference as
 * if it came from the configuration model.
 *
 * So this is the baseline's button, used by both. The version history still
 * exists and is still recorded — a participant simply has no control that
 * exposes it, which is what the baseline arm already looked like.
 *
 * Researchers keep DeployControls on non-study boards.
 *
 * A size up from its neighbours in the header, and the same size in both arms:
 * it is the study's own control on a board that is otherwise the product's, and
 * finishing the block depends on finding it.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';

export default function StudyDeployButton({
  assignmentId,
  condition,
  deployedVersionNo,
}: {
  assignmentId: string;
  condition: 'score' | 'baseline';
  /** The version students currently receive, or null if never deployed. */
  deployedVersionNo: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [deployed, setDeployed] = useState<number | null>(deployedVersionNo);
  const [note, setNote] = useState<string | null>(null);

  const endpoint =
    condition === 'baseline'
      ? `/api/instructor/assignments/${assignmentId}/score/baseline/deploy`
      : `/api/instructor/assignments/${assignmentId}/score/deploy`;

  async function deploy() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No note field in either arm: naming a version is an affordance the
        // baseline does not have.
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The SCORE route refuses a chain longer than the runtime can rate,
        // and says why — a participant can act on that, so it is shown as-is.
        setNote(typeof data?.message === 'string' ? data.message : 'Deploy failed');
        return;
      }
      if (typeof data.versionNo === 'number') setDeployed(data.versionNo);
      setNote('Deployed');
      // Both routes start freezing this version's measurement answers behind
      // the response (warm.ts); refreshing is only about the header label.
      router.refresh();
    } catch {
      setNote('Deploy failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-sm text-[hsl(var(--muted-foreground))]">
        {note ?? (deployed != null ? `Students receive v${deployed}` : 'Not deployed')}
      </span>
      <button
        onClick={deploy}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        title="Publish the current setup to the student chat"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
        Deploy
      </button>
    </span>
  );
}
