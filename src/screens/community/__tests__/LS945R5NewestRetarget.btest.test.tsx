/**
 * LS-945R5 B1 (growth-project-mobile#945 @ 33f2ffaa): a reply push or a coach's High alert carries ?message= for the
 * message just posted (backend community-space-push.service.ts:140), so in the space already on screen it names that
 * space's newest row. Tapped while she is scrolled up there (the in-app banner shows: the push's messageId is not the
 * open route's, ForegroundNotificationBanner.tsx opensOpenScreen), the installed StackRouter keeps the screen's key and
 * replaces its params (routers StackRouter.js:212-216, :234). A fresh open with those params shows that row (the
 * inverted list starts at its newest row); the mounted chat must end there too.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
const { CommonActions, StackRouter } = jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native');

const mockFlags = { communitySpaceChat: true, communityVoiceNotes: true, communityTab: true, coachCommunity: true };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockParams = { current: { cohortId: 'space-a' } as { cohortId: string; messageId?: string } };
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams.current }),
  useNavigation: () => ({ navigate: jest.fn(), getState: () => ({ routeNames: ['CommunityTab', 'CommunitySpaceChat'] }) }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, right: 0, left: 0 }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'viewer', name: 'Viewer' }) }));
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({
    data: { cohorts: [{ id: 'space-a', name: 'space-a', member_count: 4, my_role: 'client', kind: 'chat' }] },
    isLoading: false, isError: false,
  }),
}));
const mockMarkRead = jest.fn(async (_cohortId: string, _messageId: string) => true);
const row = (k: number) => ({
  id: `space-a-${k}`, cohort_id: 'space-a', kind: 'text', body: `Row ${k}`, sender_user_id: 'author',
  created_at: `2026-11-10T10:0${k}:00.000Z`, sender: { name: 'Author' },
});
const mockChat = {
  messages: [3, 2, 1].map(row),
  list: { isSuccess: true, isLoading: false, isError: false, hasNextPage: false, data: { pages: [{}] } },
  pending: [], noAccess: false, readSettled: true,
  readCursor: { last_read_at: '2026-11-10T10:00:00.000Z', last_read_message_id: null } as null | { last_read_at: string | null; last_read_message_id: string | null },
  reply: null, held: null, setReply: jest.fn(), setHeld: jest.fn(), readable: jest.fn(),
  markRead: (messageId: string) => mockMarkRead('space-a', messageId),
};
jest.mock('../../../components/community/space-chat/useSpaceChat', () => ({ useSpaceChat: () => mockChat }));
jest.mock('../../../components/community/space-chat/useSpaceVoiceOutbox', () => ({ useSpaceVoiceOutbox: () => ({ rows: [] }) }));
jest.mock('../../../components/community/SpaceDrawer', () => ({ SpaceListButton: () => null }));
jest.mock('../../../components/community/space-chat/SpaceChatComposer', () => () => null);
jest.mock('../../../components/community/space-chat/SpaceChatMic', () => () => null);
jest.mock('../../../components/community/space-chat/SpaceInfoSheet', () => () => null);
jest.mock('../../../components/community/space-chat/SpaceMessageSheet', () => () => null);
jest.mock('../../../components/messaging/ConversationClosed', () => ({
  useServerAnswered: () => true, ConversationClosedLine: () => null, CLOSED_LINE: 'This conversation is closed',
}));
jest.mock('../../../components/community/space-chat/SpaceChatRow', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ id }: { id: string }) => React.createElement(Text, { testID: `row-${id}` }, id),
    DayLine: () => null, HashGlyph: () => null, MenuGlyph: () => null, NewMessagesLine: () => null,
    spaceDay: () => 'Today', SMALL_GREY: '#2C2C2C',
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const Screen = require('../CommunitySpaceChatScreen').default;
const router = StackRouter({ initialRouteName: 'CommunitySpaceChat' });
const options = { routeNames: ['CommunitySpaceChat'], routeParamList: {}, routeGetIdList: {} };

it('LS945R5 B1: a push for the newest message of the space on screen, tapped while she is scrolled up there, brings her to it', async () => {
  const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  const toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
  try {
    const r = await render(<Screen />);
    // She opened at the New messages line, read the oldest row and stays scrolled up there (the newest is off screen).
    await act(async () => r.getByTestId('space-chat-list').props.viewabilityConfigCallbackPairs[0]
      .onViewableItemsChanged({ viewableItems: [{ key: 'new-line' }, { key: 'space-a-1' }] }));
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('space-a', 'space-a-1'));
    // Someone replies to her (or the coach sends a High alert): the newest row; the pill shows she is scrolled up.
    mockChat.messages = [row(4), ...mockChat.messages];
    await r.rerender(<Screen />);
    expect(r.getByTestId('space-chat-pill')).toBeTruthy();
    const rows = r.getByTestId('space-chat-list').props.data as Array<{ key: string }>;
    expect(rows[0].key).toBe('space-a-4');
    // The push tap: navigate to the screen on top keeps its key and replaces its params.
    const initial = router.getInitialState(options);
    const before = { ...initial, routes: initial.routes.map((route) => ({ ...route, params: mockParams.current })) };
    const next = router.getStateForAction(before, CommonActions.navigate('CommunitySpaceChat', { cohortId: 'space-a', messageId: 'space-a-4' }), options)!;
    expect(next.routes[0].key).toBe(before.routes[0].key);
    toIndex.mockClear();
    toOffset.mockClear();
    mockParams.current = next.routes[0].params as { cohortId: string; messageId?: string };
    await r.rerender(<Screen />);
    // A fresh open with these params shows the newest row; the chat she is in must be brought there.
    await waitFor(() => expect([
      ...toIndex.mock.calls.map(([a]) => (a as { index: number }).index === 0),
      ...toOffset.mock.calls.map(([a]) => (a as { offset: number }).offset === 0),
    ]).toContain(true));
  } finally {
    toIndex.mockRestore();
    toOffset.mockRestore();
  }
});
