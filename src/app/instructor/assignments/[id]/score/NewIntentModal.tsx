'use client';

/**
 * SCORE v7 — the New Intent chooser. EVERY intent is created through here.
 *
 * The chooser itself is shared with the baseline condition's New Search dialog
 * (candidate-chooser.tsx) — same proposals, same starter sets, same editor, so
 * the conditions differ in what the created object DOES, not in what its author
 * knew when they wrote it. This file is the SCORE half: the scope header, and
 * the intent vocabulary.
 */
import { ChevronRight, Plus } from 'lucide-react';
import type { ScoreQueryType } from '@/lib/score/intents';
import type { JelsonSuggestion } from '@/lib/score/jelson-suggest';
import type { ScoreQueryRow } from './IntentBoard';
import CandidateChooser, { type CandidateSeed, type ChooserCopy } from './candidate-chooser';

const COPY: ChooserCopy = {
  starterGroup: 'Starter intents',
  titleLabel: 'Title',
  titlePlaceholder: 'Auto-named on save if empty',
  definitionLabel: 'When a question…',
  definitionPlaceholder:
    'e.g. asks the chatbot to write a thesis statement or conclusion for them',
  duplicate:
    'An intent with this exact definition already exists. Edit it into a different one to create it.',
  instant: 'questions appear immediately',
  instantTitle:
    'This definition is already rated across the log — the clone copies those ratings, so no rating pass is needed.',
  create: 'Create intent',
  createTitle: 'Open the workbench seeded with this candidate',
};

interface NewIntentModalProps {
  assignmentId: string;
  /** Where the new set lands. Known in every entry path — this is what the
   * modal shows in place of the create button's position in the tree. */
  scope: { type: ScoreQueryType; parentIntentId: number | null };
  anchorRow: ScoreQueryRow | null;
  /** A SPIN-OFF: the questions ruled out of `spinOffFrom`, which the new intent
   * is being made to answer instead. */
  seedQueries?: { text: string; reason: string | null }[];
  /** The intent they were ruled out of — the new one lands BESIDE it. */
  spinOffFrom?: string | null;
  /** The set the new one is carved out of — `scope.parentIntentId` resolved.
   * Null when the type's own rule is what answers the scope today. */
  currentIntent: { id: number; title: string } | null;
  jelsonSuggestions: JelsonSuggestion[];
  templates: { id: number; title: string; definition: string }[];
  /** Definitions already live in this assignment (trimmed) — those starters are
   * still listed and still readable, just not creatable a second time. */
  liveDefinitions: Set<string>;
  openaiConfigured: boolean;
  typeLabel: string;
  /** The section dot colour, so the header reads as the same place the left
   * column shows — passed rather than imported to keep the modal off the
   * board's module graph. */
  typeDot: string;
  onCancel: () => void;
  onPick: (seed: CandidateSeed) => void;
}

export default function NewIntentModal({
  assignmentId,
  scope,
  anchorRow,
  seedQueries,
  spinOffFrom,
  currentIntent,
  jelsonSuggestions,
  templates,
  liveDefinitions,
  openaiConfigured,
  typeLabel,
  typeDot,
  onCancel,
  onPick,
}: NewIntentModalProps) {
  /* WHERE IT LANDS — the promise the tree's indentation used to make, now said
     in words. Drawn as the same path the left column shows (type dot → section
     → set) and ending in the same dashed chip that was clicked, so the dialog
     is recognisably standing in that spot. The line under it states the
     CONSEQUENCE of landing there, which is the part that surprises people: a
     subset can only ever take what its parent already took.

     This block is the ONE thing the baseline's dialog does not get. Ownership,
     the first-match chain, and what a scope forecloses ARE the treatment — a
     control condition that reads them here would have been taught the mental
     model the study is trying to measure. */
  const header = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        New intent
      </p>
      <p className="mt-1 flex items-center gap-1.5 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${typeDot}`} />
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide">{typeLabel}</span>
        {currentIntent && (
          <>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <span className="truncate text-sm font-semibold">{currentIntent.title}</span>
          </>
        )}
        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <span className="shrink-0 inline-flex items-center gap-1 rounded border border-dashed border-[hsl(var(--primary))]/60 px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--primary))]">
          <Plus className="w-3 h-3" /> new intent
        </span>
      </p>
      <p className="mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
        {currentIntent ? (
          <>
            Only questions{' '}
            <span className="font-medium text-[hsl(var(--foreground))]">
              “{currentIntent.title}”
            </span>{' '}
            already answers can land here.
          </>
        ) : (
          <>Answers {typeLabel} questions no existing intent claims first.</>
        )}
      </p>
      {/* A spin-off lands BESIDE the intent the questions were ruled out of,
          not inside it: inside, it could only ever answer what that intent
          answers, and these are precisely the ones it does not. */}
      {spinOffFrom && (
        <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          Beside{' '}
          <span className="font-medium text-[hsl(var(--foreground))]">“{spinOffFrom}”</span> — the
          questions you ruled out of it need somewhere to go.
        </p>
      )}
    </>
  );

  return (
    <CandidateChooser
      assignmentId={assignmentId}
      scopeType={scope.type}
      parentIntentId={scope.parentIntentId}
      anchorRow={anchorRow}
      seedQueries={seedQueries}
      jelsonSuggestions={jelsonSuggestions}
      templates={templates}
      existingDefinitions={liveDefinitions}
      openaiConfigured={openaiConfigured}
      typeLabel={typeLabel}
      copy={COPY}
      header={header}
      onCancel={onCancel}
      onPick={onPick}
    />
  );
}
