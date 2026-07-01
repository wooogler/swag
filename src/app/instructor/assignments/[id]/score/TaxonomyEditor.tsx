'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Download, Upload, Plus, Trash2, Save, Loader2, RotateCcw, X } from 'lucide-react';
import {
  type ScoreConfig,
  type ScoreConfigSubtype,
  type ScoreTypeKey,
  normalizeConfig,
} from '@/lib/score/config';
import { DEFAULT_SCORE_CONFIG } from '@/lib/score/default-config';

const TYPE_DOT: Record<string, string> = {
  Planning: 'bg-blue-500',
  Translating: 'bg-emerald-500',
  Reviewing: 'bg-amber-500',
  All: 'bg-violet-500',
};

// Each draft subtype carries a stable `uid` so React keys survive add/delete/
// reorder (codes can be temporarily empty/duplicate while editing). uids are
// stripped before saving/exporting.
type EditorSubtype = ScoreConfigSubtype & { uid: string };
interface EditorType {
  key: ScoreTypeKey;
  letter: string;
  label: string;
  description: string;
  subtypes: EditorSubtype[];
}
interface EditorConfig {
  version: number;
  types: EditorType[];
  noneExamples: string[];
}

let UID_SEQ = 0;
const nextUid = () => `st-${UID_SEQ++}`;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withUids(config: ScoreConfig): EditorConfig {
  return {
    version: config.version,
    noneExamples: config.noneExamples ?? [],
    types: config.types.map((t) => ({
      ...t,
      subtypes: t.subtypes.map((s) => ({ ...s, uid: nextUid() })),
    })),
  };
}

function stripUids(draft: EditorConfig): ScoreConfig {
  return {
    version: draft.version,
    noneExamples: draft.noneExamples,
    types: draft.types.map((t) => ({
      key: t.key,
      letter: t.letter,
      label: t.label,
      description: t.description,
      subtypes: t.subtypes.map(({ code, label, description, examples }) => ({ code, label, description, examples })),
    })),
  };
}

export default function TaxonomyEditor({
  open,
  onClose,
  config,
  focusCode,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  config: ScoreConfig;
  focusCode: string | null;
  onSaved: (next: ScoreConfig) => void;
}) {
  const [draft, setDraft] = useState<EditorConfig>(() => withUids(config));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset the draft to the latest config ONLY when the editor opens — not when
  // the config prop changes while open (e.g. a router.refresh() would otherwise
  // wipe unsaved edits mid-session).
  useEffect(() => {
    if (open) {
      setDraft(withUids(config));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scroll to / highlight the focused subtype on open.
  useEffect(() => {
    if (open && focusCode) {
      const t = setTimeout(() => {
        document.getElementById(`tax-st-${focusCode}`)?.scrollIntoView({ block: 'center' });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [open, focusCode]);

  // Client-side validation: codes must be non-empty and unique.
  const validation = useMemo(() => {
    const codes: string[] = [];
    for (const t of draft.types) for (const s of t.subtypes) codes.push(s.code.trim());
    const nonEmpty = codes.filter(Boolean);
    const hasEmpty = codes.some((c) => !c);
    const dupes = new Set(nonEmpty.filter((c, i) => nonEmpty.indexOf(c) !== i));
    const totalSubtypes = codes.length;
    return { hasEmpty, dupes, totalSubtypes, ok: !hasEmpty && dupes.size === 0 && totalSubtypes > 0 };
  }, [draft]);

  function updateSubtype(ti: number, si: number, patch: Partial<ScoreConfigSubtype>) {
    setDraft((prev) => {
      const next = clone(prev);
      next.types[ti].subtypes[si] = { ...next.types[ti].subtypes[si], ...patch };
      return next;
    });
  }

  function addSubtype(ti: number) {
    setDraft((prev) => {
      const next = clone(prev);
      const used = new Set(next.types.flatMap((t) => t.subtypes.map((s) => s.code)));
      const letter = next.types[ti].letter || next.types[ti].key[0];
      let n = next.types[ti].subtypes.length + 1;
      let code = `${letter}${String(n).padStart(2, '0')}`;
      while (used.has(code)) {
        n += 1;
        code = `${letter}${String(n).padStart(2, '0')}`;
      }
      next.types[ti].subtypes.push({ code, label: 'New subtype', description: '', examples: [], uid: nextUid() });
      return next;
    });
  }

  function deleteSubtype(ti: number, si: number) {
    setDraft((prev) => {
      const next = clone(prev);
      next.types[ti].subtypes.splice(si, 1);
      return next;
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(stripUids(draft), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'score-taxonomy.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const normalized = normalizeConfig(parsed?.config ?? parsed);
        if (!normalized) {
          setError('That file is not a valid taxonomy config.');
          return;
        }
        setDraft(withUids(normalized));
        setError(null);
      } catch {
        setError('Could not parse that JSON file.');
      }
    };
    reader.readAsText(file);
  }

  async function save() {
    if (!validation.ok || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/instructor/score/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: stripUids(draft) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.config) {
        setError(typeof data?.message === 'string' ? data.message : 'Failed to save the taxonomy.');
        return;
      }
      onSaved(data.config as ScoreConfig);
      onClose();
    } catch {
      setError('Failed to save the taxonomy. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-4xl max-h-[88vh] overflow-hidden flex flex-col rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
            <div>
              <DialogTitle className="text-sm font-semibold text-[hsl(var(--foreground))]">
                Taxonomy &amp; few-shot examples
              </DialogTitle>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {validation.totalSubtypes} subtypes · used in both classifier prompts
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = '';
                }}
              />
              <EditorButton onClick={() => fileRef.current?.click()} icon={<Upload className="w-3.5 h-3.5" />} label="Import" />
              <EditorButton onClick={exportJson} icon={<Download className="w-3.5 h-3.5" />} label="Export" />
              <EditorButton
                onClick={() => {
                  if (window.confirm('Reset to the built-in default taxonomy? Unsaved edits will be lost.')) {
                    setDraft(withUids(DEFAULT_SCORE_CONFIG));
                  }
                }}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                label="Reset"
              />
              <button onClick={onClose} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto px-4 py-3 space-y-5">
            {draft.types.map((type, ti) => (
              <div key={type.key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${TYPE_DOT[type.key] ?? 'bg-gray-400'}`} />
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{type.label}</h3>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">{type.description}</span>
                </div>
                <div className="space-y-2">
                  {type.subtypes.map((s, si) => {
                    const dup = s.code.trim() && validation.dupes.has(s.code.trim());
                    const empty = !s.code.trim();
                    return (
                      <div
                        key={s.uid}
                        id={`tax-st-${s.code}`}
                        className={`rounded-md border p-2.5 space-y-2 ${
                          dup || empty ? 'border-[hsl(var(--destructive))]' : 'border-[hsl(var(--border))]'
                        } ${focusCode === s.code ? 'ring-2 ring-[hsl(var(--ring))]' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            value={s.code}
                            onChange={(e) => updateSubtype(ti, si, { code: e.target.value.toUpperCase() })}
                            placeholder="CODE"
                            className="w-24 font-mono text-xs border border-[hsl(var(--border))] rounded px-2 py-1 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                          />
                          <input
                            value={s.label}
                            onChange={(e) => updateSubtype(ti, si, { label: e.target.value })}
                            placeholder="Label"
                            className="flex-1 text-sm border border-[hsl(var(--border))] rounded px-2 py-1 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                          />
                          <button
                            onClick={() => deleteSubtype(ti, si)}
                            className="p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                            aria-label="Delete subtype"
                            title="Delete subtype"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <input
                          value={s.description}
                          onChange={(e) => updateSubtype(ti, si, { description: e.target.value })}
                          placeholder="Description (shown in the prompt)"
                          className="w-full text-xs border border-[hsl(var(--border))] rounded px-2 py-1 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                        />
                        <textarea
                          value={s.examples.join('\n')}
                          onChange={(e) => updateSubtype(ti, si, { examples: e.target.value.split('\n') })}
                          placeholder="Few-shot example queries — one per line"
                          rows={Math.max(2, s.examples.length)}
                          className="w-full text-xs font-mono border border-[hsl(var(--border))] rounded px-2 py-1 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] resize-y"
                        />
                        {dup && <p className="text-[11px] text-[hsl(var(--destructive))]">Duplicate code.</p>}
                        {empty && <p className="text-[11px] text-[hsl(var(--destructive))]">Code cannot be empty.</p>}
                      </div>
                    );
                  })}
                  <button
                    onClick={() => addSubtype(ti)}
                    className="inline-flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add subtype to {type.label}
                  </button>
                </div>
              </div>
            ))}

            {/* No-category / off-topic examples */}
            <div className="border-t border-[hsl(var(--border))] pt-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Other / no category</h3>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">
                Off-topic, chit-chat, or meta queries that fit no subtype. Few-shot the &ldquo;none of the above&rdquo;
                case: Classifier A returns null, Classifier B scores everything 0.
              </p>
              <textarea
                value={draft.noneExamples.join('\n')}
                onChange={(e) => setDraft((prev) => ({ ...clone(prev), noneExamples: e.target.value.split('\n') }))}
                placeholder="Off-topic / no-category example queries — one per line"
                rows={Math.max(2, draft.noneExamples.length)}
                className="w-full text-xs font-mono border border-[hsl(var(--border))] rounded px-2 py-1 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] resize-y"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[hsl(var(--border))]">
            <div className="text-xs">
              {error ? (
                <span className="text-[hsl(var(--destructive))]">{error}</span>
              ) : !validation.ok ? (
                <span className="text-[hsl(var(--destructive))]">Fix duplicate/empty codes before saving.</span>
              ) : (
                <span className="text-[hsl(var(--muted-foreground))]">
                  Saving affects classification for all assignments. Re-classify to apply.
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-sm font-medium border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!validation.ok || saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function EditorButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-xs text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
    >
      {icon} {label}
    </button>
  );
}
