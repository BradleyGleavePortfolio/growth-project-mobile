/**
 * CREDITBUILD-143: the credit screens get a pool only for a head coach
 * (TM-W: sub-coaches skip every new credit surface) and only once it loaded;
 * the budget is not even read for anyone else. The consultation gate keeps a
 * pool it once had, so the page never vanishes mid-setup.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import type { CoachAIBudgetResponse } from '../../../../api/types/coachAIBudget';

let mockRole: 'head_coach' | 'sub_coach' | 'unknown' = 'head_coach';
let mockBudget: CoachAIBudgetResponse | undefined;
const mockUseAIBudget = jest.fn((_opts: { enabled?: boolean }) => ({ data: mockBudget }));
let mockHidden = false;
jest.mock('../../../../hooks/useCoachRoleType', () => ({ useCoachRoleType: () => mockRole }));
jest.mock('../../../../hooks/useAIBudget', () => ({ useAIBudget: (o: { enabled?: boolean }) => mockUseAIBudget(o) }));
jest.mock('../../../../config/purchaseSurfaces', () => ({ creditPacksHidden: () => mockHidden }));

import { WithCoachCredits, useCoachCredits } from '../useCoachCredits';

const BUDGET = { period_end: '2026-11-01T00:00:00.000Z', base_displayed_cents: 12500, pct_used: 0 } as CoachAIBudgetResponse;

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'head_coach';
  mockBudget = BUDGET;
  mockHidden = false;
});

describe('useCoachCredits', () => {
  it('gives a head coach the pool, with packs sold where this build sells them', async () => {
    const { result } = await renderHook(() => useCoachCredits());
    expect(result.current).toEqual({ budget: BUDGET, packsSold: true });
    expect(mockUseAIBudget).toHaveBeenLastCalledWith({ enabled: true });
  });

  it('says packs are not sold on builds that hide them', async () => {
    mockHidden = true;
    const { result } = await renderHook(() => useCoachCredits());
    expect(result.current?.packsSold).toBe(false);
  });

  it.each(['sub_coach', 'unknown'] as const)('gives a %s nothing and does not read the budget', async (role) => {
    mockRole = role;
    const { result } = await renderHook(() => useCoachCredits());
    expect(result.current).toBeNull();
    expect(mockUseAIBudget).toHaveBeenLastCalledWith({ enabled: false });
  });

  it('gives nothing while the budget loads or after it fails, and nothing when disabled', async () => {
    mockBudget = undefined;
    expect((await renderHook(() => useCoachCredits())).result.current).toBeNull();
    mockBudget = BUDGET;
    expect((await renderHook(() => useCoachCredits({ enabled: false }))).result.current).toBeNull();
    expect(mockUseAIBudget).toHaveBeenLastCalledWith({ enabled: false });
  });
});

describe('WithCoachCredits', () => {
  const view = () => (
    <WithCoachCredits>{(c) => <Text testID="pool">{c ? String(c.budget.base_displayed_cents) : 'none'}</Text>}</WithCoachCredits>
  );

  it('keeps the pool once loaded, even if a later read fails', async () => {
    const ui = await render(view());
    expect(ui.getByTestId('pool').props.children).toBe('12500');
    mockBudget = undefined;
    await ui.rerender(view());
    expect(ui.getByTestId('pool').props.children).toBe('12500');
  });

  it('hands nothing to a sub-coach', async () => {
    mockRole = 'sub_coach';
    const ui = await render(view());
    expect(ui.getByTestId('pool').props.children).toBe('none');
  });
});
