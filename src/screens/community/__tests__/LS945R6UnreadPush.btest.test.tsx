/**
 * LS-945R6 follow-up F1 (growth-project-mobile#945 @ a0fe0331, found outside the fix commits, A1.9 step 3; not a B of
 * m#945): the server's "unread" space push carries the space's link with no ?message= (backend
 * community-space-push.service.ts:140), the same params a list tap opens the space with. Tapped for the space already
 * on screen, opened from a list and scrolled up, the installed StackRouter keeps the screen's key and hands it a new
 * params object with equal values (routers StackRouter.js:212-216, createParamsFromAction.js); the in-app banner
 * shows, because the banner check never sees the space chat as the open screen (pushTapRouter.ts pushTapLanding). A
 * fresh open with that link lands on the New messages line, just above the new message; the chat she is in must be
 * brought there too. At a0fe0331 nothing moves: CommunitySpaceChatScreen.tsx:241 starts the visit over only when the
 * message asked for changes.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
const { CommonActions, StackRouter } = jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native');

const SPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mockSpace = SPACE;
const mockFlags = { communitySpaceChat: true, communityVoiceNotes: true, communityTab: true, coachCommunity: true };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockParams = { current: { cohortId: SPACE } as { cohortId: string; messageId?: string } };
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
    data: { cohorts: [{ id: mockSpace, name: 'Running', member_count: 4, my_role: 'client', kind: 'chat' }] },
    isLoading: false, isError: false,
  }),
}));
const mockMarkRead = jest.fn(async (_cohortId: string, _messageId: string) => true);
const row = (k: number) => ({
  id: `row-${k}`, cohort_id: SPACE, kind: 'text', body: `Row ${k}`, sender_user_id: 'author',
  created_at: `2026-11-10T10:0${k}:00.000Z`, sender: { name: 'Author' },
});
// She has read everything: the read line sits at the newest row, so the space opens at its newest rows.
const mockChat = {
  messages: [3, 2, 1].map(row),
  list: { isSuccess: true, isLoading: false, isError: false, hasNextPage: false, data: { pages: [{}] } },
  pending: [], noAccess: false, readSettled: true,
  readCursor: { last_read_at: '2026-11-10T10:03:00.000Z', last_read_message_id: 'row-3' } as null | { last_read_at: string | null; last_read_message_id: string | null },
  reply: null, held: null, setReply: jest.fn(), setHeld: jest.fn(), readable: jest.fn(),
  markRead: (messageId: string) => mockMarkRead(mockSpace, messageId),
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
const { incomingLinkPath, resolveAppLink } = require('../../../navigation/incomingLinks') as typeof import('../../../navigation/incomingLinks');
const router = StackRouter({ initialRouteName: 'CommunitySpaceChat' });
const options = { routeNames: ['CommunitySpaceChat'], routeParamList: {}, routeGetIdList: {} };
type Pair = { onViewableItemsChanged: (info: unknown) => void };

it('LS945R6 F1: an unread push for the space on screen, tapped while she is scrolled up there, brings her to the new message', async () => {
  const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  const toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
  try {
    // She opened the space from a list (no message asked for), then dragged up and reads its oldest row.
    const r = await render(<Screen />);
    const list = () => r.getByTestId('space-chat-list');
    const see = (...keys: string[]) => act(async () => (list().props.viewabilityConfigCallbackPairs as Pair[])[0]
      .onViewableItemsChanged({ viewableItems: keys.map((key) => ({ key })) }));
    await see('row-3', 'row-2');
    await act(async () => { list().props.onScrollBeginDrag?.(); });
    await see('row-1');
    // Someone posts. The list draws the row under a New messages line and the pill shows she is scrolled up.
    mockChat.messages = [row(4), ...mockChat.messages];
    await r.rerender(<Screen />);
    expect(r.getByTestId('space-chat-pill')).toBeTruthy();
    const keys = (list().props.data as Array<{ key: string }>).map((i) => i.key);
    expect(keys.slice(0, 2)).toEqual(['row-4', 'new-line']);
    // The server's unread push for this space: its link has no ?message=, so it resolves to the params the list tap
    // opened the space with.
    const target = resolveAppLink(incomingLinkPath(`tgp://community/cohorts/${SPACE}`)!, 'student')!;
    expect(target).toEqual({ root: 'CommunityTab', screen: 'CommunitySpaceChat', params: { cohortId: SPACE }, initial: false });
    // The tap: navigate to the screen on top keeps its key and hands it the delivery's own params object.
    const initial = router.getInitialState(options);
    const before = { ...initial, routes: initial.routes.map((route) => ({ ...route, params: mockParams.current })) };
    const next = router.getStateForAction(before, CommonActions.navigate('CommunitySpaceChat', target.params), options)!;
    expect(next.routes[0].key).toBe(before.routes[0].key);
    expect(next.routes[0].params).toEqual(mockParams.current);
    expect(next.routes[0].params).not.toBe(mockParams.current);
    toIndex.mockClear();
    toOffset.mockClear();
    mockParams.current = next.routes[0].params as { cohortId: string; messageId?: string };
    await r.rerender(<Screen />);
    // A fresh open with this link lands on the New messages line (index 1, just above the new row); the chat she is in
    // must be brought to it, or to the newest rows.
    await waitFor(() => expect([
      ...toIndex.mock.calls.map(([a]) => (a as { index: number }).index <= 1),
      ...toOffset.mock.calls.map(([a]) => (a as { offset: number }).offset === 0),
    ]).toContain(true));
  } finally {
    toIndex.mockRestore();
    toOffset.mockRestore();
  }
});
