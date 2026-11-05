/**
 * FIN-868R5 B1: a coach who opens Community offline sees the inbox card
 * "Your inbox loads when you reconnect." React Native has no browser online
 * event, so React Query never refetches on reconnect by itself: every coach
 * read must reload once when the phone comes back online.
 */
import React from 'react';
import NetInfo from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  COACH_EMPTY_STATE_SURFACE_KEYS,
  CoachCommunityApiError,
  coachCommunityApi,
} from '../../api/coachCommunityApi';
import {
  useCoachCohortDetail,
  useCoachCohorts,
  useCoachDashboard,
  useCoachEmptyStates,
  useCoachFlagged,
  useCoachInbox,
  useCoachPostDetail,
} from '../useCoachCommunity';

jest.mock('../../api/coachCommunityApi', () => {
  const actual = jest.requireActual('../../api/coachCommunityApi');
  return {
    ...actual,
    coachCommunityApi: {
      getDashboard: jest.fn(),
      getInbox: jest.fn(),
      getCohorts: jest.fn(),
      getCohortDetail: jest.fn(),
      getFlagged: jest.fn(),
      getCoachPostDetail: jest.fn(),
      getCoachEmptyStates: jest.fn(),
    },
  };
});

const net = NetInfo as unknown as {
  __setState: (next: { isConnected: boolean }) => void;
  __reset: () => void;
};
const api = coachCommunityApi as unknown as Record<string, jest.Mock>;
const roman = Object.fromEntries(
  COACH_EMPTY_STATE_SURFACE_KEYS.map((surface_key) => [
    surface_key,
    { text: 'Roman says hello.', avatar_crop: 'smile', surface_key },
  ]),
);

type Read = { isError: boolean; isSuccess: boolean };
const READS: Array<[string, () => Read, string, unknown]> = [
  ['dashboard', () => useCoachDashboard(), 'getDashboard', { unanswered: 0 }],
  ['inbox', () => useCoachInbox(), 'getInbox', { items: [], next_cursor: null }],
  ['cohorts', () => useCoachCohorts(), 'getCohorts', []],
  ['cohort', () => useCoachCohortDetail('c1'), 'getCohortDetail', { id: 'c1' }],
  ['reported posts', () => useCoachFlagged(), 'getFlagged', []],
  ['post', () => useCoachPostDetail('p1'), 'getCoachPostDetail', { id: 'p1' }],
  ['Roman copy after a failure', () => useCoachEmptyStates(), 'getCoachEmptyStates', roman],
];

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  qc.clear();
  net.__reset();
  jest.clearAllMocks();
});

it.each(READS)('the coach %s read reloads when the phone comes back online', async (_name, useRead, fn, ok) => {
  api[fn]
    .mockRejectedValueOnce(new CoachCommunityApiError('network', 0, 'offline'))
    .mockResolvedValue(ok);
  const { result } = await renderHook(useRead, { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));

  await act(async () => net.__setState({ isConnected: false }));
  expect(api[fn]).toHaveBeenCalledTimes(1);
  await act(async () => net.__setState({ isConnected: true }));

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(api[fn]).toHaveBeenCalledTimes(2);
});

it('Roman copy that already loaded is not fetched again on reconnect (it never changes)', async () => {
  api.getCoachEmptyStates.mockResolvedValue(roman);
  const { result } = await renderHook(() => useCoachEmptyStates(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  await act(async () => net.__setState({ isConnected: false }));
  await act(async () => net.__setState({ isConnected: true }));
  expect(api.getCoachEmptyStates).toHaveBeenCalledTimes(1);
});
