'use client';

/**
 * Word-level rule diff, dependency-free. Rules are short prose prompts
 * (≤8000 chars), so the classic two-pass shape is enough: LCS over LINES
 * first, then LCS over words inside each changed line pair — bounded work,
 * and the output reads as "this sentence changed" rather than a token soup.
 *
 * Used wherever a proposed rule is shown against the one it revises: the
 * proposal-variant chooser and the feedback chat's changelog cards.
 */
import { useMemo } from 'react';

type OpKind = 'same' | 'removed' | 'added';
interface Op<T> {
  kind: OpKind;
  item: T;
}

/** Classic LCS diff over arrays (DP + backtrack). Inputs here are lines of a
 * rule or words of a line, so n·m stays small. */
function diffArrays<T>(a: T[], b: T[]): Op<T>[] {
  const n = a.length;
  const m = b.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', item: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'removed', item: a[i] });
      i++;
    } else {
      ops.push({ kind: 'added', item: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'removed', item: a[i++] });
  while (j < m) ops.push({ kind: 'added', item: b[j++] });
  return ops;
}

/** Words and the whitespace between them, both kept — joining tokens back
 * reproduces the line verbatim. */
function tokenize(line: string): string[] {
  return line.match(/\s+|\S+/g) ?? [];
}

export interface DiffSegment {
  kind: OpKind;
  text: string;
}

/** One rendered line of the diff. A MODIFIED line carries mixed segments; a
 * fully added/removed line carries one segment of that kind. */
export interface DiffLine {
  segments: DiffSegment[];
}

export function diffRules(before: string, after: string): DiffLine[] {
  const lineOps = diffArrays(before.split('\n'), after.split('\n'));
  const lines: DiffLine[] = [];
  // Pair each run of removed lines with the added run that follows it — the
  // k-th removed line against the k-th added — and word-diff each pair, so an
  // edited sentence shows as one line with struck/added words instead of a
  // whole-line delete + whole-line insert.
  let k = 0;
  while (k < lineOps.length) {
    const op = lineOps[k];
    if (op.kind === 'same') {
      lines.push({ segments: [{ kind: 'same', text: op.item }] });
      k++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < lineOps.length && lineOps[k].kind !== 'same') {
      (lineOps[k].kind === 'removed' ? removed : added).push(lineOps[k].item);
      k++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) {
      const wordOps = diffArrays(tokenize(removed[p]), tokenize(added[p]));
      const segments: DiffSegment[] = [];
      for (const w of wordOps) {
        const last = segments[segments.length - 1];
        if (last && last.kind === w.kind) last.text += w.item;
        else segments.push({ kind: w.kind, text: w.item });
      }
      lines.push({ segments });
    }
    for (let p = pairs; p < removed.length; p++) {
      lines.push({ segments: [{ kind: 'removed', text: removed[p] }] });
    }
    for (let p = pairs; p < added.length; p++) {
      lines.push({ segments: [{ kind: 'added', text: added[p] }] });
    }
  }
  return lines;
}

/** Inline rendering: unchanged text plain, removed struck-through red, added
 * green — the reader sees exactly what a proposal did to the rule. */
export function RuleDiff({
  before,
  after,
  className = '',
}: {
  before: string | null;
  after: string | null;
  className?: string;
}) {
  const lines = useMemo(() => diffRules(before ?? '', after ?? ''), [before, after]);
  return (
    <div className={`whitespace-pre-wrap text-xs leading-relaxed ${className}`}>
      {lines.map((line, i) => (
        <p key={i} className="min-h-[1em]">
          {line.segments.map((seg, j) =>
            seg.kind === 'same' ? (
              <span key={j}>{seg.text}</span>
            ) : seg.kind === 'removed' ? (
              <del key={j} className="bg-rose-50 text-rose-700 decoration-rose-400">
                {seg.text}
              </del>
            ) : (
              <ins key={j} className="bg-emerald-50 text-emerald-800 no-underline">
                {seg.text}
              </ins>
            )
          )}
        </p>
      ))}
    </div>
  );
}
