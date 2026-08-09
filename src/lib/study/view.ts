/**
 * The SINGLE decision point for which studio view (SCORE board vs Baseline
 * studio) an assignment page renders. Keeping this in one function is what makes
 * "add participant isolation later" a one-line change instead of an audit of
 * every button and route. See docs/STUDY_BASELINE_SPEC.md §1.3.
 */
import type { StudioView } from './config';

export function resolveStudioView(opts: {
  storedCondition: StudioView | null; // study_clones.condition (null if not a clone)
  viewParam: string | null; // ?view=score|baseline
  isParticipant: boolean; // getCurrentStudyParticipant() != null
}): StudioView {
  // ── PHASE 2 (live): a participant sees the condition assigned to this clone
  //    and nothing else. ?view is ignored for them — seeing the other tool
  //    would collapse the within-subject comparison the study is built on.
  //    Administrators keep the override: previewing both is how the research
  //    team checks parity, and they are never a data point.
  if (opts.isParticipant) return opts.storedCondition ?? 'score';

  if (opts.viewParam === 'score' || opts.viewParam === 'baseline') return opts.viewParam;
  return opts.storedCondition ?? 'score';
}
