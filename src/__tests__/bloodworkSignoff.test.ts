/**
 * Tests for `src/lib/bloodworkSignoff.ts`.
 *
 * Behavioural rules being pinned:
 *   - AI insights only render when `coach_reviewed` AND `aiDraft.status === 'approved'`
 *   - `hidden_from_client` and `disputed_flagged` always suppress the panel
 *   - `needs_clinician_context` shows the panel but never AI insights, and
 *     uses the clinician_referral disclaimer level
 *   - non-final review states show the panel without AI insights, with
 *     the educational disclaimer level
 *   - state transitions are gated by `canTransition` (no jumping straight
 *     from `draft_client_entered` to `coach_reviewed`)
 */

import {
  decideClientVisibility,
  isAIDraftApproved,
  canTransition,
} from '../lib/bloodworkSignoff';
import {
  BloodworkAIDraft,
  BloodworkPanel,
  BloodworkReviewState,
} from '../types/bloodwork';

function panelOf(
  reviewState: BloodworkReviewState,
  aiDraft?: BloodworkAIDraft,
): Pick<BloodworkPanel, 'reviewState' | 'aiDraft' | 'disclaimerLevel'> {
  return {
    reviewState,
    aiDraft,
    disclaimerLevel: 'educational',
  };
}

describe('decideClientVisibility', () => {
  it('hides the panel when the coach has hidden it', () => {
    const r = decideClientVisibility(panelOf('hidden_from_client'));
    expect(r.showPanel).toBe(false);
    expect(r.showAIInsights).toBe(false);
    expect(r.disclaimerLevel).toBe('hidden');
  });

  it('hides the panel when it is flagged as disputed', () => {
    const r = decideClientVisibility(panelOf('disputed_flagged'));
    expect(r.showPanel).toBe(false);
    expect(r.showAIInsights).toBe(false);
  });

  it('shows the panel without AI insights when referred to a clinician', () => {
    const draft: BloodworkAIDraft = { status: 'approved', educationalTipsForClient: ['tip'] };
    const r = decideClientVisibility(panelOf('needs_clinician_context', draft));
    expect(r.showPanel).toBe(true);
    expect(r.showAIInsights).toBe(false);
    expect(r.disclaimerLevel).toBe('clinician_referral');
  });

  it('shows the panel without AI insights while awaiting coach review', () => {
    const states: BloodworkReviewState[] = ['draft_client_entered', 'submitted', 'needs_source'];
    for (const s of states) {
      const r = decideClientVisibility(panelOf(s));
      expect(r.showPanel).toBe(true);
      expect(r.showAIInsights).toBe(false);
      expect(r.disclaimerLevel).toBe('educational');
    }
  });

  it('does NOT surface AI insights when coach_reviewed but draft is not approved', () => {
    for (const status of ['none', 'pending', 'unapproved', 'rejected'] as const) {
      const r = decideClientVisibility(
        panelOf('coach_reviewed', { status }),
      );
      expect(r.showPanel).toBe(true);
      expect(r.showAIInsights).toBe(false);
    }
  });

  it('surfaces AI insights only when coach_reviewed AND draft.status === approved', () => {
    const draft: BloodworkAIDraft = { status: 'approved', educationalTipsForClient: ['hydrate'] };
    const r = decideClientVisibility(panelOf('coach_reviewed', draft));
    expect(r.showPanel).toBe(true);
    expect(r.showAIInsights).toBe(true);
  });

  it('returns showAIInsights=false when there is no AI draft at all', () => {
    const r = decideClientVisibility(panelOf('coach_reviewed'));
    expect(r.showAIInsights).toBe(false);
  });
});

describe('isAIDraftApproved', () => {
  it('is false for undefined drafts', () => {
    expect(isAIDraftApproved(undefined)).toBe(false);
  });
  it('is true only for approved status', () => {
    expect(isAIDraftApproved({ status: 'approved' })).toBe(true);
    expect(isAIDraftApproved({ status: 'unapproved' })).toBe(false);
    expect(isAIDraftApproved({ status: 'rejected' })).toBe(false);
    expect(isAIDraftApproved({ status: 'pending' })).toBe(false);
    expect(isAIDraftApproved({ status: 'none' })).toBe(false);
  });
});

describe('canTransition', () => {
  it('forbids jumping from draft straight to coach_reviewed', () => {
    expect(canTransition('draft_client_entered', 'coach_reviewed')).toBe(false);
  });

  it('allows submit → coach_reviewed', () => {
    expect(canTransition('submitted', 'coach_reviewed')).toBe(true);
  });

  it('allows coach_reviewed → hidden_from_client', () => {
    expect(canTransition('coach_reviewed', 'hidden_from_client')).toBe(true);
  });

  it('forbids hidden_from_client → disputed_flagged (must go via review path)', () => {
    expect(canTransition('hidden_from_client', 'disputed_flagged')).toBe(false);
  });
});
