/**
 * CSV for the study exports.
 *
 * Extracted so the bulk export and the per-participant trail download cannot
 * quote differently — a file that opens cleanly in one place and splits a
 * column in the other is the kind of thing nobody notices until analysis.
 *
 * Union of every row's keys, so a field that only some rows carry still gets a
 * column instead of silently shifting the rest.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}
