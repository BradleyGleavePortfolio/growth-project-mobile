/**
 * FX-COMM (agent 170): the coach inbox is never saved to the phone
 * (meta.persist false, same as useVoiceFeed), so a restart cannot show rows
 * from someone the coach blocked or banned since (OWNER DECISION 6352484857).
 * The line is the same in m#868 and m#865; the test lives here.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { coachCommunityKeys, useCoachInbox } from '../useCoachCommunity';

jest.mock('../../api/coachCommunityApi', () => ({
  coachCommunityApi: {
    getInbox: jest.fn(async () => ({ items: [], next_cursor: null })),
  },
}));

it('keeps the coach inbox off the phone', async () => {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = await renderHook(() => useCoachInbox(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const query = qc.getQueryCache().find({ queryKey: coachCommunityKeys.inbox() });
  expect(query?.meta).toEqual({ persist: false });
});
