import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CoachInboxPage } from '../../api/coachCommunityApi';
import { coachCommunityKeys, dropAuthorFromCoachInbox } from '../useCoachCommunity';

jest.mock('../../api/coachCommunityApi', () => ({ coachCommunityApi: {} }));

it('a blocked or banned person leaves every cached inbox page, then coach reads refetch', () => {
  const qc = new QueryClient();
  const row = (id: string, client_user_id: string) =>
    ({ id, client_user_id }) as unknown as CoachInboxPage['items'][number];
  qc.setQueryData<InfiniteData<CoachInboxPage>>(coachCommunityKeys.inbox(), {
    pageParams: [undefined, 'c2'],
    pages: [
      { items: [row('a', 'x'), row('b', 'y')], next_cursor: 'c2' },
      { items: [row('c', 'x')], next_cursor: null },
    ],
  });
  const refetch = jest.spyOn(qc, 'invalidateQueries');
  dropAuthorFromCoachInbox(qc, 'x');
  const cached = qc.getQueryData<InfiniteData<CoachInboxPage>>(coachCommunityKeys.inbox());
  expect(cached?.pages.flatMap((p) => p.items.map((i) => i.id))).toEqual(['b']);
  expect(refetch).toHaveBeenCalledWith({ queryKey: coachCommunityKeys.all });
});
