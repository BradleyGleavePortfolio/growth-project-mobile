/**
 * FX-COMM (agent 170): the coach inbox, the reported-posts queue and a post are
 * never saved to the phone (meta.persist false, same as useVoiceFeed), so a
 * restart cannot show content from someone the coach blocked or banned since
 * (OWNER DECISION 6352484857). The lines are the same in m#868 and m#865; the
 * test lives here.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  coachCommunityKeys,
  useCoachFlagged,
  useCoachInbox,
  useCoachPostDetail,
} from '../useCoachCommunity';

jest.mock('../../api/coachCommunityApi', () => ({
  coachCommunityApi: {
    getInbox: jest.fn(async () => ({ items: [], next_cursor: null })),
    getFlagged: jest.fn(async () => []),
    getCoachPostDetail: jest.fn(async () => ({ id: 'p1' })),
  },
}));

const cases: Array<[string, () => { isSuccess: boolean }, readonly unknown[]]> = [
  ['the coach inbox', () => useCoachInbox(), coachCommunityKeys.inbox()],
  ['the reported posts', () => useCoachFlagged(), coachCommunityKeys.flagged()],
  ['a post', () => useCoachPostDetail('p1'), coachCommunityKeys.post('p1')],
];

it.each(cases)('keeps %s off the phone', async (_name, hook, key) => {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = await renderHook(hook, { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(qc.getQueryCache().find({ queryKey: key })?.meta).toEqual({
    persist: false,
  });
});
