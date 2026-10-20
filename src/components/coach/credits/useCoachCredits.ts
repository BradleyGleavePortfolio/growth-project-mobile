/**
 * The coach's AI credit pool for the CREDITBUILD screens, or null.
 *
 * Head coaches only: the members roster must name this coach head_coach
 * (useCoachRoleType fails closed, and an active sub-coach gets a 403 there),
 * because a sub-coach's budget read returns the head coach's pool and
 * sub-coaches skip every new credit surface until TM-W. Null while the role
 * or the budget is loading, when either fails, and for sub-coaches, so a
 * caller simply shows nothing. `packsSold` picks the approved wording for
 * builds that sell credit packs and builds that do not.
 */
import type React from 'react';
import { useMemo, useRef } from 'react';
import { useAIBudget } from '../../../hooks/useAIBudget';
import { useCoachRoleType } from '../../../hooks/useCoachRoleType';
import { creditPacksHidden } from '../../../config/purchaseSurfaces';
import type { CoachAIBudgetResponse } from '../../../api/types/coachAIBudget';

export interface CoachCredits {
  budget: CoachAIBudgetResponse;
  packsSold: boolean;
}

export function useCoachCredits(options: { enabled?: boolean } = {}): CoachCredits | null {
  const { enabled = true } = options;
  const role = useCoachRoleType();
  const head = enabled && role === 'head_coach';
  const { data } = useAIBudget({ enabled: head });
  return useMemo(() => (head && data ? { budget: data, packsSold: !creditPacksHidden() } : null), [head, data]);
}

/**
 * Render-prop gate for the coach consultation: hands the flow the pool once
 * it has loaded and keeps it, so KC never disappears under a coach mid-setup
 * when a later refetch fails. Mounted only with featureFlags.coachAiCredits.
 */
export function WithCoachCredits({ children }: { children: (credits: CoachCredits | null) => React.ReactElement }) {
  const current = useCoachCredits();
  const kept = useRef<CoachCredits | null>(null);
  if (current) kept.current = current;
  return children(kept.current);
}
