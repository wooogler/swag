'use client';

/**
 * SCORE v6 — chatbot Deploy modal.
 *
 * The SCORE board is staging; this is the release valve. A two-pane review of
 * exactly what is about to be frozen — intents on the LEFT, the selected
 * intent's definition / labels / rule on the RIGHT — plus a name for the
 * version, and one Deploy button. Students always chat against the LATEST
 * deploy; past versions are browsable from the header dropdown.
 */
import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Rocket, X } from 'lucide-react';

interface LiveIntent {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  /** Version labels, mirroring the board's intents panel display. */
  intentVersionNo: number;
  latestRuleVersion: { versionNo: number; name: string | null } | null;
  /** The instructor's labeled examples (pins) — actual question text, the same
   * list the Intent modal shows. These freeze into the deploy snapshot. */
  pins: { messageId: number; verdict: 'in' | 'out'; queryText: string }[];
}

interface DeploySummary {
  versionNo: number;
  createdAt: string;
  note: string | null;
  intentCount: number;
  ruleCount: number;
}

export interface DeployStatus {
  latest: DeploySummary | null;
  dirty: boolean;
  live: { intentCount: number; ruleCount: number; intents: LiveIntent[] };
}

interface DeployModalProps {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  /** Called after a successful deploy (new version recorded). */
  onDeployed: () => void;
}

export default function DeployModal({ open, onClose, assignmentId, onDeployed }: DeployModalProps) {
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Labeled-example groups (Included/Excluded), same collapsible UI as the
  // Intent modal. Open by default — the point of the pane is reviewing them.
  const [incOpen, setIncOpen] = useState(true);
  const [excOpen, setExcOpen] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/deploy`);
      const d = (await res.json().catch(() => null)) as DeployStatus | null;
      if (!res.ok || !d) throw new Error('Failed to load the deploy status.');
      setStatus(d);
      setSelectedId((prev) => prev ?? d.live.intents[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    if (open) {
      setStatus(null);
      setSelectedId(null);
      setName('');
      refresh();
    }
  }, [open, refresh]);

  async function deploy() {
    if (deploying || !status) return;
    setDeploying(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name.trim() ? { note: name.trim() } : {}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d?.message === 'string' ? d.message : 'Deploy failed.');
      }
      onDeployed();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeploying(false);
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const selected = status?.live.intents.find((i) => i.id === selectedId) ?? null;

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-3xl h-[75vh] flex flex-col overflow-hidden rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
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

          {/* Status line */}
          <div className="shrink-0 px-4 py-2 border-b border-[hsl(var(--border))] text-xs">
            {!status && loading ? (
              <p className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading deploy status…
              </p>
            ) : status ? (
              <p>
                {status.latest ? (
                  <>
                    Students are on <span className="font-semibold">chat v{status.latest.versionNo}</span>
                    {status.latest.note ? ` · ${status.latest.note}` : ''}{' '}
                    <span className="text-[hsl(var(--muted-foreground))]">({fmt(status.latest.createdAt)})</span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Not deployed yet</span>{' '}
                    <span className="text-[hsl(var(--muted-foreground))]">— students get the chatbot as it is today.</span>
                  </>
                )}{' '}
                <span className={status.dirty ? 'text-amber-700' : 'text-[hsl(var(--muted-foreground))]'}>
                  {status.dirty
                    ? '· Undeployed changes below.'
                    : '· The board matches what students are getting.'}
                </span>
              </p>
            ) : null}
          </div>

          {/* Two-pane review: intents | selected intent detail */}
          <div className="flex-1 min-h-0 grid grid-cols-[220px_minmax(0,1fr)] divide-x divide-[hsl(var(--border))]">
            <div className="min-h-0 overflow-y-auto">
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Intents to deploy ({status?.live.intents.length ?? 0})
              </p>
              {status?.live.intents.length === 0 && (
                <p className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                  No active intents — students would get the chatbot as it is today.
                </p>
              )}
              {/* Same item shape as the board's intents panel: title + short
                  When/Then VERSION labels (full text on the right when selected). */}
              {status?.live.intents.map((i) => (
                <button
                  key={i.id}
                  onClick={() => setSelectedId(i.id)}
                  className={`w-full text-left px-3 py-2 border-b border-[hsl(var(--border))]/60 ${
                    selectedId === i.id ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                  }`}
                >
                  <span className="block text-sm font-medium truncate">{i.title}</span>
                  <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                    <span className="font-semibold">When</span>{' '}
                    {i.intentVersionNo > 0 ? `v${i.intentVersionNo} ` : ''}
                    {i.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                    <span className="font-semibold">Then</span>{' '}
                    {i.latestRuleVersion ? (
                      `v${i.latestRuleVersion.versionNo}${
                        i.latestRuleVersion.name ? ` ${i.latestRuleVersion.name}` : ''
                      }`
                    ) : i.rule?.trim() ? (
                      i.rule
                    ) : (
                      <span className="italic">No rule yet</span>
                    )}
                  </span>
                </button>
              ))}
            </div>

            <div className="min-h-0 overflow-y-auto p-3 space-y-2.5 text-xs">
              {selected ? (
                <>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Intent
                    </p>
                    <p className="font-medium">{selected.title}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Definition (when)
                    </p>
                    <p className="whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{selected.definition}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Labeled examples{' '}
                      <span className="font-normal normal-case">— frozen into the deploy with the spec</span>
                    </p>
                    {(
                      [
                        {
                          key: 'in' as const,
                          label: 'Included',
                          rows: selected.pins.filter((p) => p.verdict === 'in'),
                          open: incOpen,
                          setOpen: setIncOpen,
                          head: 'text-emerald-700 bg-emerald-50/60 hover:bg-emerald-50',
                        },
                        {
                          key: 'out' as const,
                          label: 'Excluded',
                          rows: selected.pins.filter((p) => p.verdict === 'out'),
                          open: excOpen,
                          setOpen: setExcOpen,
                          head: 'text-rose-700 bg-rose-50/60 hover:bg-rose-50',
                        },
                      ]
                    ).map((g) => (
                      <div key={g.key} className="rounded border border-[hsl(var(--border))] overflow-hidden">
                        <button
                          onClick={() => g.setOpen((v) => !v)}
                          className={`w-full flex items-center justify-between px-2 py-1 text-[11px] font-medium ${g.head}`}
                        >
                          <span>
                            {g.label} · {g.rows.length}
                          </span>
                          {g.open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {g.open &&
                          (g.rows.length > 0 ? (
                            <ul className="max-h-40 overflow-y-auto divide-y divide-[hsl(var(--border))]/60 border-t border-[hsl(var(--border))]">
                              {g.rows.map((r) => (
                                <li key={r.messageId} className="px-2 py-1.5 text-[11px] text-[hsl(var(--foreground))]">
                                  {(() => {
                                    const c = r.queryText.replace(/\s+/g, ' ').trim();
                                    return c.length > 120 ? `${c.slice(0, 120)}…` : c;
                                  })()}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="px-2 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))]">
                              None yet — label questions in the Intent modal.
                            </p>
                          ))}
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Rule (then)
                      {selected.latestRuleVersion && (
                        <span className="ml-1 font-normal normal-case">
                          — v{selected.latestRuleVersion.versionNo}
                          {selected.latestRuleVersion.name ? ` · ${selected.latestRuleVersion.name}` : ''}
                        </span>
                      )}
                    </p>
                    {selected.rule?.trim() ? (
                      <p className="whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2">
                        {selected.rule}
                      </p>
                    ) : (
                      <p className="italic text-[hsl(var(--muted-foreground))]">
                        No rule yet — this intent adds nothing to the chatbot.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-[hsl(var(--muted-foreground))]">Select an intent on the left to review it.</p>
              )}
            </div>
          </div>

          {/* Footer: version name + Deploy */}
          <div className="shrink-0 px-4 py-3 border-t border-[hsl(var(--border))] space-y-1.5">
            {error && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Version name (optional) — e.g. "Scaffolding rules for essays"`}
                maxLength={300}
                className="flex-1 text-xs border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
              />
              <button
                onClick={deploy}
                disabled={deploying || !status || !status.dirty}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                title={
                  status?.dirty
                    ? 'Freeze the current intent→rule set as a new version and serve it to students'
                    : 'Nothing to deploy — students already match the board'
                }
              >
                {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
                Deploy{status?.latest ? ` → chat v${status.latest.versionNo + 1}` : ' → chat v1'}
              </button>
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              A deploy freezes the intents&apos; definitions, labels, rules, and tie-breakers. Students always get
              the latest version; board edits stay invisible until the next deploy.
            </p>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
