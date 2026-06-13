/**
 * Behavioural test (R26) for `useWeeklyVolumeBreakdown`.
 *
 * Bug being guarded:
 *   Earlier code piped every session `date` field through
 *   `bucketDateLocal(new Date(stamp))` unconditionally. When the
 *   backend returns a bare calendar day like `"2026-05-23"`,
 *   `new Date("2026-05-23")` parses as UTC midnight, and a user
 *   west of UTC then has that session re-bucketed to the prior local
 *   day. The fix (`src/hooks/useApi.ts:316-318`) bypasses the Date
 *   round-trip for bare `YYYY-MM-DD` strings and uses them as-is.
 *
 * This test mocks `workoutApi.getAll` to return a session whose `date`
 * is the bare string `"2026-05-23"`, pins `bucketDateLocal` to
 * America/Los_Angeles to make the regression deterministic, then
 * renders the hook and asserts the volume lands in the `"2026-05-23"`
 * bucket — not `"2026-05-22"`.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../services/api', () => ({
  __esModule: true,
  habitsApi: {},
  workoutApi: {
    getAll: jest.fn(),
  },
  communityApi: {},
  nudgesApi: {},
  notificationsApi: {},
  weightApi: {},
  logApi: {},
  checkInsApi: {},
  coachApi: {},
  mealPlansApi: {},
  messagesApi: {},
}));

// Pin the device tz so the test is deterministic on any CI host.
jest.mock('../../utils/date', () => {
  const actual = jest.requireActual('../../utils/date');
  return {
    ...actual,
    bucketDateLocal: (date?: Date) =>
      actual.bucketDateLocal(date ?? new Date(), 'America/Los_Angeles'),
  };
});

import { workoutApi } from '../../services/api';
import { useWeeklyVolumeBreakdown } from '../useApi';

const mockedGetAll = workoutApi.getAll as jest.MockedFunction<typeof workoutApi.getAll>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

describe('useWeeklyVolumeBreakdown — bare date string is not shifted west-of-UTC', () => {
  beforeEach(() => {
    mockedGetAll.mockReset();
  });

  it('returns a 2026-05-23 bucket (not 2026-05-22) for a bare-date session in LA tz', async () => {
    mockedGetAll.mockResolvedValueOnce({
      data: {
        workouts: [
          {
            date: '2026-05-23',
            exercises: [{ sets: 3, reps: 10, weight_lbs: 100 }],
          },
        ],
      },
    } as never);

    const { wrapper } = makeWrapper();
    const { result } = await renderHook(
      () => useWeeklyVolumeBreakdown('2026-05-18', '2026-05-24'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const breakdown = result.current.data?.breakdown ?? [];
    const dates = breakdown.map((b) => b.date);
    expect(dates).toContain('2026-05-23');
    expect(dates).not.toContain('2026-05-22');

    const may23 = breakdown.find((b) => b.date === '2026-05-23');
    expect(may23?.volume).toBe(3 * 10 * 100);
  });
});
