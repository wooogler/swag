'use client';

/**
 * Baseline header Deploy — the ablation counterpart of SCORE's DeployControls, in
 * the same header slot. One click publishes the prompt-holder's CURRENT rule (the
 * system prompt authored in Revise) to the student chat. No version dropdown: the
 * baseline has no per-version board view, just "what students currently receive".
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { postJSON } from './http';

export default function BaselineDeployButton({
  assignmentId,
  deployedVersionNo,
}: {
  assignmentId: string;
  deployedVersionNo: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [deployed, setDeployed] = useState<number | null>(deployedVersionNo);
  const [note, setNote] = useState<string | null>(null);

  async function deploy() {
    setBusy(true);
    setNote(null);
    try {
      const { versionNo } = await postJSON<{ versionNo: number }>(
        `/api/instructor/assignments/${assignmentId}/score/baseline/deploy`,
        {}
      );
      setDeployed(versionNo);
      setNote('Deployed');
      router.refresh();
    } catch (e) {
      setNote(`Deploy failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {note ? (
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{note}</span>
      ) : (
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {deployed != null ? `Students receive v${deployed}` : 'Not deployed'}
        </span>
      )}
      <button
        onClick={deploy}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        title="Publish the current system prompt to the student chat"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
        Deploy
      </button>
    </span>
  );
}
