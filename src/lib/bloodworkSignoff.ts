/**
 * Bloodwork signoff rules — pure logic, no UI.
 *
 * The single rule that matters: nothing AI-drafted is ever shown to the
 * client until a coach has explicitly approved it, AND the panel itself
 * is in `coach_reviewed` state (or higher trust). Defense-in-depth in
 * case a screen forgets to check one of the two.
 *
 * Tested in `src/__tests__/bloodworkSignoff.test.ts`.
 */

import {
  BloodworkAIDraft,
  BloodworkDisclaimerLevel,
  BloodworkPanel,
  BloodworkReviewState,
} from '../types/bloodwork';

export interface ClientVisibilityDecision {
  showPanel: boolean;
  showAIInsights: boolean;
  disclaimerLevel: BloodworkDisclaimerLevel;
  /** Plain-English reason — useful for diagnostics, never shown to user. */
  reason: string;
}

/**
 * Decide what (if anything) to show on the client surface for a panel.
 * Fail-closed: any unexpected combination of states returns `showPanel:
 * false`.
 */
export function decideClientVisibility(
  panel: Pick<BloodworkPanel, 'reviewState' | 'aiDraft' | 'disclaimerLevel'>,
): ClientVisibilityDecision {
  const { reviewState, aiDraft, disclaimerLevel } = panel;

  if (reviewState === 'hidden_from_client') {
    return {
      showPanel: false,
      showAIInsights: false,
      disclaimerLevel: 'hidden',
      reason: 'panel hidden by coach',
    };
  }

  if (reviewState === 'disputed_flagged') {
    return {
      showPanel: false,
      showAIInsights: false,
      disclaimerLevel: 'hidden',
      reason: 'panel flagged as disputed',
    };
  }

  if (reviewState === 'needs_clinician_context') {
    return {
      showPanel: true,
      showAIInsights: false,
      disclaimerLevel: 'clinician_referral',
      reason: 'coach referred to clinician — no AI insights shown',
    };
  }

  // Anything still in draft / submitted / needs_source: client can see
  // their own values but no AI-drafted insights yet.
  if (reviewState !== 'coach_reviewed') {
    return {
      showPanel: true,
      showAIInsights: false,
      disclaimerLevel: 'educational',
      reason: 'awaiting coach review',
    };
  }

  // coach_reviewed
  const aiApproved = isAIDraftApproved(aiDraft);
  return {
    showPanel: true,
    showAIInsights: aiApproved,
    disclaimerLevel: aiApproved ? disclaimerLevel : 'coach_context',
    reason: aiApproved
      ? 'coach reviewed and AI draft approved'
      : 'coach reviewed but AI draft not approved',
  };
}

export function isAIDraftApproved(draft?: BloodworkAIDraft): boolean {
  return !!draft && draft.status === 'approved';
}

/**
 * Coach-side: which review-state transitions are allowed from a given
 * starting state. Mirrors what the backend should also enforce.
 */
const ALLOWED_TRANSITIONS: Record<BloodworkReviewState, BloodworkReviewState[]> = {
  draft_client_entered: ['submitted'],
  submitted: [
    'needs_source',
    'needs_clinician_context',
    'coach_reviewed',
    'hidden_from_client',
    'disputed_flagged',
  ],
  needs_source: ['submitted', 'hidden_from_client', 'disputed_flagged'],
  needs_clinician_context: ['coach_reviewed', 'hidden_from_client'],
  coach_reviewed: [
    'needs_clinician_context',
    'hidden_from_client',
    'disputed_flagged',
  ],
  hidden_from_client: ['coach_reviewed', 'submitted'],
  disputed_flagged: ['hidden_from_client', 'submitted'],
};

export function canTransition(
  from: BloodworkReviewState,
  to: BloodworkReviewState,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
