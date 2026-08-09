'use client';

/**
 * BASELINE — the New Filter chooser. The same dialog SCORE opens to create an
 * intent (candidate-chooser.tsx), with the same three ways to start: candidates
 * drafted from the question in view, the taxonomy's starter sets for this query
 * type, or blank.
 *
 * The ONE difference is the header, and it is the whole ablation. SCORE's says
 * where the new set LANDS and what that forecloses — a scope owns its
 * questions, and a subset can only take what its parent already took. A filter
 * claims nothing: it collects the matching questions of its type for reading,
 * and two filters can happily collect the same question. So the header here
 * states search semantics ("finds what matches") where SCORE's states
 * ownership ("answers what nothing claims first") — the same slot, each
 * condition's mechanism in one sentence. See docs/STUDY_BASELINE_SPEC.md §B-2.
 */
import { Plus } from 'lucide-react';
import type { ScoreQueryType } from '@/lib/score/intents';
import type { JelsonSuggestion } from '@/lib/score/jelson-suggest';
import type { ScoreQueryRow } from './IntentBoard';
import CandidateChooser, { type CandidateSeed, type ChooserCopy } from './candidate-chooser';

const COPY: ChooserCopy = {
  starterGroup: 'Starter filters',
  titleLabel: 'Name',
  titlePlaceholder: 'Auto-named on save if empty',
  definitionLabel: 'When a question…',
  definitionPlaceholder:
    'e.g. asks the chatbot to write a thesis statement or conclusion for them',
  duplicate:
    'A saved filter with this exact description already exists. Edit it into a different one to create it.',
  instant: 'questions appear immediately',
  instantTitle:
    'This description has already been run across the log — the results come from that cache, so there is no wait.',
  create: 'Create filter',
  createTitle: 'Open the filter seeded with this description',
};

interface NewFilterModalProps {
  assignmentId: string;
  /** Which query type's starter suggestions are offered — and the type the new
   * filter will live under. Unlike SCORE's scope this places no claim: the
   * filter shows its type's matching questions and owns none of them. */
  scopeType: ScoreQueryType;
  anchorRow: ScoreQueryRow | null;
  jelsonSuggestions: JelsonSuggestion[];
  templates: { id: number; title: string; definition: string }[];
  /** Descriptions already saved as filters (trimmed) — offered, readable, but
   * not creatable a second time. */
  savedDescriptions: Set<string>;
  openaiConfigured: boolean;
  typeLabel: string;
  typeDot: string;
  onCancel: () => void;
  onPick: (seed: CandidateSeed) => void;
}

export default function NewFilterModal({
  assignmentId,
  scopeType,
  anchorRow,
  jelsonSuggestions,
  templates,
  savedDescriptions,
  openaiConfigured,
  typeLabel,
  typeDot,
  onCancel,
  onPick,
}: NewFilterModalProps) {
  const header = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        New filter
      </p>
      <p className="mt-1 flex items-center gap-1.5 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${typeDot}`} />
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide">{typeLabel}</span>
        <span className="shrink-0 inline-flex items-center gap-1 rounded border border-dashed border-[hsl(var(--primary))]/60 px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--primary))]">
          <Plus className="w-3 h-3" /> new filter
        </span>
      </p>
      <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
        Finds every {typeLabel} question matching this description.
      </p>
    </>
  );

  return (
    <CandidateChooser
      assignmentId={assignmentId}
      scopeType={scopeType}
      anchorRow={anchorRow}
      jelsonSuggestions={jelsonSuggestions}
      templates={templates}
      existingDefinitions={savedDescriptions}
      openaiConfigured={openaiConfigured}
      typeLabel={typeLabel}
      copy={COPY}
      header={header}
      onCancel={onCancel}
      onPick={onPick}
    />
  );
}
