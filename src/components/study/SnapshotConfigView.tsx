'use client';

/**
 * The participant's DEPLOYED configuration, read-only, for the block test.
 *
 * It must stay on screen while they predict: the measure is whether they can
 * read their own configuration and tell what it will do, not whether they
 * memorised it. So this renders the frozen deploy snapshot — not the live board
 * state, which may already have moved on — and shows the whole thing rather
 * than a summary.
 *
 * (The board's own deploy modal looks similar but reads live state through its
 * own fetch, so it cannot serve this purpose.)
 */

export interface SnapshotIntentView {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  kind: string;
  type: string | null;
  parentId: number | null;
  position: number | null;
}

export interface SnapshotConfig {
  condition: 'score' | 'baseline';
  versionLabel: string;
  /** SCORE only: the deployed tree. */
  intents?: SnapshotIntentView[];
  /** Baseline only: the deployed rules document. */
  rules?: string;
}

const TYPE_ORDER = ['planning', 'translating', 'reviewing', 'drafting'] as const;
const TYPE_DOT: Record<string, string> = {
  planning: 'bg-blue-500',
  translating: 'bg-emerald-500',
  reviewing: 'bg-amber-500',
  drafting: 'bg-violet-500',
};
const TYPE_LABEL: Record<string, string> = {
  planning: 'Planning',
  translating: 'Translating',
  reviewing: 'Reviewing',
  drafting: 'Drafting',
};

export default function SnapshotConfigView({ config }: { config: SnapshotConfig }) {
  if (config.condition === 'baseline') {
    return (
      <div className="flex flex-col h-full">
        <Header label="Your rules" version={config.versionLabel} />
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {config.rules?.trim() ? (
            <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-[hsl(var(--foreground))]">
              {config.rules}
            </pre>
          ) : (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              No rules were written, so the chatbot answers with no instructions of yours.
            </p>
          )}
        </div>
      </div>
    );
  }

  const intents = config.intents ?? [];
  const roots = intents.filter((i) => i.kind === 'type_root');
  const authored = intents.filter((i) => i.kind === 'intent');

  return (
    <div className="flex flex-col h-full">
      <Header label="Your setup" version={config.versionLabel} />
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {TYPE_ORDER.map((type) => {
          const root = roots.find((r) => r.type === type);
          const mine = authored.filter((i) => i.type === type);
          if (!root && mine.length === 0) return null;
          return (
            <section key={type}>
              <div className="flex items-center gap-2 px-1 pb-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[type]}`} />
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {TYPE_LABEL[type]}
                </span>
              </div>
              <div className="space-y-1.5">
                {/* Children before parents, mirroring the order the chatbot
                    checks them in — the tree IS the order of evaluation. */}
                {orderChain(mine).map((intent) => (
                  <IntentCard key={intent.id} intent={intent} depth={depthOf(intent, mine)} />
                ))}
                {root && (
                  <div className="rounded-lg border border-dashed border-[hsl(var(--border))] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
                      Anything else in {TYPE_LABEL[type]}
                    </p>
                    <RuleText rule={root.rule} />
                  </div>
                )}
              </div>
            </section>
          );
        })}
        {authored.length === 0 && (
          <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">
            You did not add any groups, so every question falls to the defaults above.
          </p>
        )}
      </div>
    </div>
  );
}

function Header({ label, version }: { label: string; version: string }) {
  return (
    <div className="px-4 py-2 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{version}</span>
    </div>
  );
}

function IntentCard({ intent, depth }: { intent: SnapshotIntentView; depth: number }) {
  return (
    <div
      className="rounded-lg border border-[hsl(var(--border))] px-3 py-2 bg-[hsl(var(--card))]"
      style={{ marginLeft: depth * 14 }}
    >
      <p className="text-xs font-semibold mb-1">{intent.title}</p>
      <p className="text-[11.5px] text-[hsl(var(--muted-foreground))] leading-snug mb-1.5">
        <span className="font-semibold">When </span>
        {intent.definition}
      </p>
      <RuleText rule={intent.rule} />
    </div>
  );
}

function RuleText({ rule }: { rule: string | null }) {
  if (!rule?.trim()) {
    return (
      <p className="text-[11.5px] italic text-[hsl(var(--muted-foreground))]">
        No instructions — the chatbot answers however it normally would.
      </p>
    );
  }
  return (
    <pre className="whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-[hsl(var(--foreground))]">
      {rule}
    </pre>
  );
}

/** Depth by ancestor walk, so nesting reads the way it did on the board. */
function depthOf(intent: SnapshotIntentView, all: SnapshotIntentView[]): number {
  let depth = 0;
  let current = intent;
  const seen = new Set<number>([current.id]);
  while (current.parentId != null) {
    const parent = all.find((i) => i.id === current.parentId);
    if (!parent || seen.has(parent.id)) break; // defensive: a broken tree still renders
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return Math.min(depth, 4);
}

/**
 * Post-order (children before their parent), siblings by (position ?? id) —
 * the chain-compilation order, so what a participant reads top to bottom is
 * the order their chatbot actually checks.
 */
function orderChain(intents: SnapshotIntentView[]): SnapshotIntentView[] {
  const byParent = new Map<number | null, SnapshotIntentView[]>();
  for (const intent of intents) {
    const key = intent.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(intent);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.position ?? a.id) - (b.position ?? b.id) || a.id - b.id);
  }
  const out: SnapshotIntentView[] = [];
  const visit = (parentId: number | null, guard: number) => {
    if (guard > 8) return;
    for (const intent of byParent.get(parentId) ?? []) {
      visit(intent.id, guard + 1);
      out.push(intent);
    }
  };
  visit(null, 0);
  // Anything orphaned by a missing parent still gets shown.
  for (const intent of intents) if (!out.includes(intent)) out.push(intent);
  return out;
}
