'use client';

/**
 * SCORE v6 — chatbot Deploy modal.
 *
 * The SCORE board is staging; this is the release valve. Shows what students
 * are currently served (latest deploy), whether the live intent→rule set has
 * undeployed changes, a Deploy button, and the version history with per-version
 * Redeploy (rollback = re-deploying an old snapshot as a NEW version).
 */
import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { AlertTriangle, Loader2, RotateCcw, Rocket, X } from 'lucide-react';

interface DeploySummary {
  versionNo: number;
  createdAt: string;
  note: string | null;
  intentCount: number;
  ruleCount: number;
  intents: { id: number; title: string; hasRule: boolean }[];
  configVersionNo: number;
}

export interface DeployStatus {
  latest: DeploySummary | null;
  dirty: boolean;
  live: { intentCount: number; ruleCount: number };
  versions: DeploySummary[];
}

interface DeployModalProps {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  /** Push the freshly fetched status up so the board badge stays in sync. */
  onStatus: (status: DeployStatus) => void;
}

export default function DeployModal({ open, onClose, assignmentId, onStatus }: DeployModalProps) {
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState<number | 'live' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/deploy`);
      const d = (await res.json().catch(() => null)) as DeployStatus | null;
      if (!res.ok || !d) throw new Error('Failed to load the deploy status.');
      setStatus(d);
      onStatus(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [assignmentId, onStatus]);

  useEffect(() => {
    if (open) {
      setStatus(null);
      refresh();
    }
  }, [open, refresh]);

  async function deploy(fromVersion?: number) {
    if (deploying) return;
    setDeploying(fromVersion ?? 'live');
    setError(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fromVersion !== undefined ? { fromVersion } : {}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d?.message === 'string' ? d.message : 'Deploy failed.');
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeploying(null);
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
            <DialogTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Rocket className="w-4 h-4" /> Deploy to students
            </DialogTitle>
            <button
              onClick={onClose}
              className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-xs">
            {error && (
              <p className="flex items-center gap-1 text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </p>
            )}
            {!status && loading && (
              <p className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading deploy status…
              </p>
            )}
            {status && (
              <>
                {/* Current state */}
                <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 space-y-1">
                  <p>
                    {status.latest ? (
                      <>
                        Students are on{' '}
                        <span className="font-semibold">chat v{status.latest.versionNo}</span>{' '}
                        <span className="text-[hsl(var(--muted-foreground))]">
                          ({fmt(status.latest.createdAt)} · {status.latest.intentCount} intents ·{' '}
                          {status.latest.ruleCount} rules)
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">Not deployed yet</span>{' '}
                        <span className="text-[hsl(var(--muted-foreground))]">
                          — students get the base prompt only.
                        </span>
                      </>
                    )}
                  </p>
                  <p className={status.dirty ? 'text-amber-700' : 'text-[hsl(var(--muted-foreground))]'}>
                    {status.dirty
                      ? `Undeployed changes — the board now has ${status.live.intentCount} intents (${status.live.ruleCount} rules).`
                      : 'The board matches what students are getting.'}
                  </p>
                </div>

                <button
                  onClick={() => deploy()}
                  disabled={deploying !== null || !status.dirty}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                  title={
                    status.dirty
                      ? 'Freeze the current intent→rule set as a new version and serve it to students'
                      : 'Nothing to deploy — students already match the board'
                  }
                >
                  {deploying === 'live' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Rocket className="w-3.5 h-3.5" />
                  )}
                  Deploy current config
                  {status.latest ? ` → v${status.latest.versionNo + 1}` : ' → v1'}
                </button>

                {/* History */}
                {status.versions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      History
                    </p>
                    <ul className="space-y-1.5">
                      {status.versions.map((v) => (
                        <li
                          key={v.versionNo}
                          className="rounded border border-[hsl(var(--border))] px-2.5 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono">v{v.versionNo}</span>
                            <span className="truncate text-[hsl(var(--muted-foreground))]">
                              {v.intentCount} intents · {v.ruleCount} rules
                              {v.note ? ` · ${v.note}` : ''}
                            </span>
                            <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
                              {fmt(v.createdAt)}
                            </span>
                          </div>
                          {v.intents.length > 0 && (
                            <p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))] truncate">
                              {v.intents.map((i) => `${i.title}${i.hasRule ? '' : ' (no rule)'}`).join(' · ')}
                            </p>
                          )}
                          {status.latest?.versionNo !== v.versionNo && (
                            <button
                              onClick={() => deploy(v.versionNo)}
                              disabled={deploying !== null}
                              className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50"
                              title={`Serve v${v.versionNo}'s intent→rule set again (recorded as a new version)`}
                            >
                              {deploying === v.versionNo ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              Redeploy
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  A deploy freezes the intents&apos; definitions, labels, rules, and exception links.
                  Students always get the latest version; board edits stay invisible until the next
                  deploy. The base prompt follows the assignment settings live.
                </p>
              </>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
