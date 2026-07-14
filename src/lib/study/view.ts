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
  // ── PHASE 2 (enable before the study launches): participants are locked to
  //    their assigned condition and cannot use ?view to peek at the other tool.
  // if (opts.isParticipant) return opts.storedCondition ?? 'score';

  // ── PHASE 1 (current — dev/pilot): open. Anyone can preview either via ?view.
  if (opts.viewParam === 'score' || opts.viewParam === 'baseline') return opts.viewParam;
  return opts.storedCondition ?? 'score';
}
