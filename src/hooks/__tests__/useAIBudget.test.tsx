/**
 * useAIBudget — hook surface tests.
 *
 * Verifies:
 *   - The hook calls `coachAiBudgetApi.getBudget()` and returns the DTO.
 *   - Disabling via `enabled: false` suspends the query (no fetch).
 *   - The fetched data maps cleanly to `surfaceFor()` at each threshold.
 *
 * We mock the axios-layer at `coachAiBudgetApi` rather than at axios itself
 * — fewer moving parts, tighter contract, fewer surprises when axios
 * minor-versions change.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../api/coachAiBudgetApi', () => ({
  coachAiBudgetApi: {
    getBudget: jest.fn(),
    createCheckout: jest.fn(),
  },
  CUSTOM_PACK_MIN_CENTS: 1000,
  CUSTOM_PACK_MAX_CENTS: 50000,
}));

import { coachAiBudgetApi } from '../../api/coachAiBudgetApi';
import { useAIBudget } from '../useAIBudget';
import { surfaceFor, type CoachAIBudgetResponse } from '../../api/types/coachAIBudget';

const mockedGetBudget = coachAiBudgetApi.getBudget as jest.MockedFunction<
  typeof coachAiBudgetApi.getBudget
>;

function budgetAt(pct: number): CoachAIBudgetResponse {
  return {
    period_start: '2026-05-01T00:00:00Z',
    period_end: '2026-06-01T00:00:00Z',
    base_displayed_cents: 12500,
    pack_displayed_cents: 0,
    total_displayed_cents: 12500,
    used_displayed_cents: Math.round((pct / 100) * 12500),
    remaining_displayed_cents: Math.round(((100 - pct) / 100) * 12500),
    pct_used: pct,
    base_actual_cents: 4000,
    value_multiplier: '3.125',
    actual_used_cents: Math.round((pct / 100) * 4000),
    pack_options_cents: [1000, 2500, 9900],
    custom_pack_bounds_cents: { min: 1000, max: 50000 },
  };
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

describe('useAIBudget', () => {
  beforeEach(() => {
    mockedGetBudget.mockReset();
  });

  it('fetches the budget DTO and exposes it on success', async () => {
    const dto = budgetAt(62.5);
    mockedGetBudget.mockResolvedValueOnce({ data: dto } as never);
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useAIBudget(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(dto);
    expect(mockedGetBudget).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when enabled=false', async () => {
    mockedGetBudget.mockResolvedValueOnce({ data: budgetAt(50) } as never);
    const { Wrapper } = makeWrapper();
    await renderHook(() => useAIBudget({ enabled: false }), { wrapper: Wrapper });
    // Wait a tick to confirm no fetch fires.
    await new Promise((r) => setTimeout(r, 30));
    expect(mockedGetBudget).not.toHaveBeenCalled();
  });

  it.each([
    [50, 'hidden'],
    [70, 'chip'],
    [85, 'tutorial'],
    [97, 'banner'],
    [100, 'paused'],
  ])('hook data at pct=%s drives surface %s', async (pct, expected) => {
    mockedGetBudget.mockResolvedValueOnce({ data: budgetAt(pct) } as never);
    const { Wrapper } = makeWrapper();
    const { result } = await renderHook(() => useAIBudget(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(surfaceFor(result.current.data)).toBe(expected);
  });
});
