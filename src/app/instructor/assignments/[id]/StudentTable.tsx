
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import DeleteStudentSessionButton from './DeleteStudentSessionButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PlayCircle, FileText, Users, MessageSquare, Loader2 } from 'lucide-react';
import type { StudentSearchMatch } from '@/app/api/instructor/assignments/[id]/student-search/route';

interface StudentWithStats {
  id: string;
  participantToken: string;
  startedAt: Date;
  lastSavedAt: Date | null;
  stats: {
    submissions: number;
    pasteInternal: number;
    pasteExternal: number;
    snapshots: number;
    gptInquiries: number;
  };
}

interface StudentTableProps {
  students: StudentWithStats[];
  assignmentId: string;
}

/** Below this the term is not a search — one character matches most of a class.
 * Mirrors the API's own floor; the client just doesn't make the trip. */
const MIN_QUERY = 2;
/** How long typing must pause before the text search runs. Long enough that a
 * typed word is one request, short enough to feel like it answers as you type. */
const SEARCH_DEBOUNCE_MS = 250;

/** The term marked up wherever it occurs, so a snippet shows at a glance which
 * word put the student in the results. Case-insensitive, like the search. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, from)) {
    if (at > from) out.push(text.slice(from, at));
    out.push(
      <mark key={at} className="rounded-[2px] bg-amber-100 px-0.5 text-amber-900">
        {text.slice(at, at + term.length)}
      </mark>
    );
    from = at + term.length;
  }
  out.push(text.slice(from));
  return <>{out}</>;
}

/** One source's hits under a matched student row: what was searched, how many
 * times it hit, and the passages themselves. */
function MatchSource({
  icon,
  label,
  count,
  snippets,
  term,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  snippets: string[];
  term: string;
}) {
  if (count === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
        {icon}
        {label} · {count}
      </span>
      <div className="min-w-0 space-y-1">
        {snippets.map((s, i) => (
          <p key={i} className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
            <Highlight text={s} term={term} />
          </p>
        ))}
        {count > snippets.length && (
          <p className="text-xs italic text-[hsl(var(--muted-foreground))]">
            +{count - snippets.length} more — open Summary or Replay to read the rest
          </p>
        )}
      </div>
    </div>
  );
}

const columnHelper = createColumnHelper<StudentWithStats>();

export default function StudentTable({ students, assignmentId }: StudentTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'participantToken', desc: false }
  ]);
  const [sortKey, setSortKey] = useState('participantToken:asc');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [search, setSearch] = useState('');
  /** The last text-search response — the term it answered, its hits by session,
   * and whether it failed. Kept while a newer term is still in flight so the
   * table doesn't collapse to token-only matches on every keystroke. */
  const [result, setResult] = useState<{
    q: string;
    bySession: Map<string, StudentSearchMatch>;
    failed: boolean;
  } | null>(null);
  const [searching, setSearching] = useState(false);

  // Essays and chat questions are far too much text to ship with the page, so
  // the box searches them over the API instead — debounced, and superseded by
  // the next keystroke. Participant tokens are already here and are matched
  // below without waiting for any of this.
  useEffect(() => {
    const q = search.trim();
    if (q.length < MIN_QUERY) {
      setResult(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(
        `/api/instructor/assignments/${assignmentId}/student-search?q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      )
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search failed (${res.status})`))))
        .then((data: { q: string; matches: StudentSearchMatch[] }) => {
          if (cancelled) return;
          setResult({
            q,
            bySession: new Map(data.matches.map((m) => [m.sessionId, m])),
            failed: false,
          });
        })
        .catch(() => {
          // Degrade to the token search rather than to an empty table: the rows
          // that match on participant are still real answers.
          if (!cancelled) setResult({ q, bySession: new Map(), failed: true });
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [search, assignmentId]);

  const trimmed = search.trim();
  const matches = result?.bySession ?? null;
  const visibleStudents = useMemo(() => {
    if (!trimmed) return students;
    const q = trimmed.toLowerCase();
    return students.filter(
      (s) => s.participantToken.toLowerCase().includes(q) || matches?.has(s.id)
    );
  }, [students, trimmed, matches]);

  const columns = useMemo(
    () => [
      columnHelper.accessor('participantToken', {
        id: 'participantToken',
        header: 'Participant',
        cell: (info) => (
          <div className="text-sm font-medium text-[hsl(var(--foreground))] font-mono">
            {info.getValue() || '—'}
          </div>
        ),
      }),
      columnHelper.accessor('startedAt', {
        header: 'Started',
        cell: (info) => (
          <span className="text-sm text-[hsl(var(--muted-foreground))]">
            {new Date(info.getValue()).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        ),
      }),
      columnHelper.accessor('lastSavedAt', {
        header: 'Last Active',
        cell: (info) => (
          <span className="text-sm text-[hsl(var(--muted-foreground))]">
            {info.getValue() ? new Date(info.getValue()!).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '-'}
          </span>
        ),
      }),
      columnHelper.accessor('stats.submissions', {
        header: 'Submissions',
        cell: (info) => (
          <div className="flex">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
              {info.getValue()}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor('stats.gptInquiries', {
        header: 'GPT Inquiries',
        cell: (info) => (
          <div className="flex">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
              <MessageSquare className="h-3 w-3" />
              {info.getValue()}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor((row) => row.stats, {
        id: 'pastes',
        header: 'Copy/Paste',
        cell: (info) => {
          const stats = info.getValue();
          return (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                <span className="font-medium text-emerald-600">{stats.pasteInternal}</span> internal
              </span>
              {stats.pasteExternal > 0 && (
                <span className="text-xs text-[hsl(var(--destructive))] font-medium">
                  {stats.pasteExternal} external
                </span>
              )}
            </div>
          );
        },
        enableSorting: false,
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        cell: (info) => {
          const student = info.row.original;
          return (
            <div className="flex items-center justify-end gap-1">
              <div className="flex items-center">
                <Link
                  href={`/instructor/summary/${student.id}`}
                  data-tooltip-id="student-actions-tooltip"
                  data-tooltip-content="View Summary"
                >
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">
                    <FileText className="w-4 h-4" />
                  </Button>
                </Link>
                <Link
                  href={`/instructor/replay/${student.id}`}
                  data-tooltip-id="student-actions-tooltip"
                  data-tooltip-content="Replay Session"
                >
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">
                    <PlayCircle className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
              <div className="w-px h-4 bg-[hsl(var(--border))] mx-1" />
              <div
                data-tooltip-id="student-actions-tooltip"
                data-tooltip-content="Delete Student Work"
              >
                <DeleteStudentSessionButton
                  sessionId={student.id}
                  studentName={student.participantToken}
                />
              </div>
            </div>
          );
        },
      }),
    ],
    []
  );

  // Filtering happens above rather than through the table's global filter: that
  // one can only see the loaded columns, and half of what the box now searches
  // (essays, questions) never reaches the browser as a column at all.
  const table = useReactTable({
    data: visibleStudents,
    columns,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: (updater) => {
      const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(nextSorting);
      if (nextSorting[0]) {
        setSortKey(`${nextSorting[0].id}:${nextSorting[0].desc ? 'desc' : 'asc'}`);
      }
    },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 20,
      },
    },
  });

  if (students.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="w-16 h-16 bg-[hsl(var(--muted))] rounded-full flex items-center justify-center mx-auto mb-4">
          <Users className="w-8 h-8 text-[hsl(var(--muted-foreground))]" />
        </div>
        <p className="text-[hsl(var(--muted-foreground))]">No students have started this assignment yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Search Bar */}
      <div className="p-4 border-b border-[hsl(var(--border))] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm w-full">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search participant, essay, or questions..."
              className="pl-9 pr-9"
            />
            {searching && (
              <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-[hsl(var(--muted-foreground))]" />
            )}
          </div>
          {/* What the term reached. Without this a one-letter search silently
              matches on participant only, and reads as an essay search that
              found nothing. */}
          {trimmed && (
            <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              {trimmed.length < MIN_QUERY
                ? `Participant only — type ${MIN_QUERY} characters to search essays and questions`
                : result?.failed
                  ? 'Essay and question search is unavailable — showing participant matches only'
                  : `${visibleStudents.length} of ${students.length} students · participant, essay, and questions`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
          <span className="text-xs uppercase tracking-wide">Sort by</span>
          <select
            value={sortKey}
            onChange={(e) => {
              const value = e.target.value;
              setSortKey(value);
              const [id, direction] = value.split(':');
              setSorting([{ id, desc: direction === 'desc' }]);
            }}
            className="border border-[hsl(var(--border))] rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
          >
            <option value="participantToken:asc">Participant (P-001 → ...)</option>
            <option value="participantToken:desc">Participant (... → P-001)</option>
            <option value="startedAt:desc">Started (Newest)</option>
            <option value="startedAt:asc">Started (Oldest)</option>
            <option value="lastSavedAt:desc">Last Active (Newest)</option>
            <option value="lastSavedAt:asc">Last Active (Oldest)</option>
            <option value="stats.submissions:desc">Submissions (High → Low)</option>
            <option value="stats.submissions:asc">Submissions (Low → High)</option>
            <option value="stats.gptInquiries:desc">GPT Inquiries (High → Low)</option>
            <option value="stats.gptInquiries:asc">GPT Inquiries (Low → High)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[hsl(var(--border))]">
          <thead className="bg-[hsl(var(--muted))]/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={`px-6 py-3 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider ${header.column.getCanSort() ? 'cursor-pointer select-none hover:text-[hsl(var(--foreground))]' : ''
                        } ${header.id === 'actions' ? 'text-right' : ''}`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className={`flex items-center gap-2 ${header.id === 'actions' ? 'justify-end' : ''}`}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span
                            className={`text-[10px] font-semibold ${
                              isSorted
                                ? 'text-[hsl(var(--foreground))]'
                                : 'text-[hsl(var(--muted-foreground))]'
                            }`}
                            aria-hidden="true"
                          >
                            {isSorted === 'asc' ? '▲' : isSorted === 'desc' ? '▼' : '▵'}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="bg-[hsl(var(--card))] divide-y divide-[hsl(var(--border))]">
            {/* A miss is ordinary now that the box searches prose, not just a
                column of tokens — so say so, rather than leaving bare headers
                over an empty body. */}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-6 py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
                  No student matched “{trimmed}” — not in a participant ID, an essay, or a question.
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row) => {
              // Why this row matched — shown only when the text search is what
              // put it here. A row that matched on participant alone needs no
              // explanation: the token is right there in the first column.
              const match = matches?.get(row.original.id);
              const hasPassages = !!match && match.essayCount + match.questionCount > 0;
              return (
                <Fragment key={row.id}>
                  <tr className="hover:bg-[hsl(var(--muted))]/30 transition-colors">
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={`px-6 py-4 whitespace-nowrap ${cell.column.id === 'actions' ? 'text-right' : ''
                          }`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {hasPassages && (
                    <tr className="bg-[hsl(var(--muted))]/20">
                      <td colSpan={row.getVisibleCells().length} className="px-6 pb-4 pt-0 space-y-2">
                        <MatchSource
                          icon={<FileText className="h-3 w-3" />}
                          label="Essay"
                          count={match.essayCount}
                          snippets={match.essaySnippets}
                          term={result?.q ?? ''}
                        />
                        <MatchSource
                          icon={<MessageSquare className="h-3 w-3" />}
                          label="Questions"
                          count={match.questionCount}
                          snippets={match.questionSnippets}
                          term={result?.q ?? ''}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm text-[hsl(var(--muted-foreground))]">
            {table.getFilteredRowModel().rows.length === 0 ? (
              'No students to show'
            ) : (
              <>
                Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
                {Math.min(
                  (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                  table.getFilteredRowModel().rows.length
                )}{' '}
                of {table.getFilteredRowModel().rows.length} students
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[hsl(var(--muted-foreground))] hidden sm:inline">Rows per page</span>
            <select
              value={table.getState().pagination.pageSize}
              onChange={(e) => {
                table.setPageSize(Number(e.target.value));
              }}
              className="border border-[hsl(var(--border))] rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
            >
              {[10, 20, 30, 50, 100].map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            className="h-8 w-8"
          >
            <ChevronsLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 w-8"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium text-[hsl(var(--foreground))] px-2">
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-8 w-8"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            className="h-8 w-8"
          >
            <ChevronsRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Tooltip
        id="student-actions-tooltip"
        place="top"
        style={{
          backgroundColor: 'hsl(var(--foreground))',
          color: 'hsl(var(--background))',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          zIndex: 50
        }}
        noArrow
      />
    </div>
  );
}
