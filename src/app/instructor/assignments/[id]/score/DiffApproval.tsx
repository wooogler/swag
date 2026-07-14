'use client';

/**
 * Word-level diff of two texts with approve/reject — shared by SCORE (rule diff)
 * and baseline (prompt diff). Spec §4.4.
 */
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';

type Part = { type: 'same' | 'add' | 'del'; text: string };

function wordDiff(a: string, b: string): Part[] {
  const aw = a.split(/(\s+)/);
  const bw = b.split(/(\s+)/);
  const n = aw.length, m = bw.length;
  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = aw[i] === bw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Part[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aw[i] === bw[j]) { out.push({ type: 'same', text: aw[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: aw[i] }); i++; }
    else { out.push({ type: 'add', text: bw[j] }); j++; }
  }
  while (i < n) out.push({ type: 'del', text: aw[i++] });
  while (j < m) out.push({ type: 'add', text: bw[j++] });
  return out;
}

interface DiffApprovalProps {
  before: string;
  after: string;
  rationale?: string;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export default function DiffApproval({ before, after, rationale, busy, onApprove, onReject }: DiffApprovalProps) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
      {rationale && (
        <div className="px-3 py-2 border-b border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]">{rationale}</div>
      )}
      <div className="max-h-64 overflow-y-auto px-3 py-2 text-sm font-mono leading-relaxed whitespace-pre-wrap">
        {parts.map((p, i) =>
          p.type === 'same' ? (
            <span key={i}>{p.text}</span>
          ) : p.type === 'add' ? (
            <span key={i} className="bg-green-500/20 text-green-700 dark:text-green-300 rounded-sm">{p.text}</span>
          ) : (
            <span key={i} className="bg-red-500/20 text-red-700 dark:text-red-300 line-through rounded-sm">{p.text}</span>
          )
        )}
      </div>
      <div className="px-3 py-2 border-t border-[hsl(var(--border))] flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onReject} disabled={busy}>거부</Button>
        <Button size="sm" onClick={onApprove} disabled={busy}>승인 (적용)</Button>
      </div>
    </div>
  );
}
