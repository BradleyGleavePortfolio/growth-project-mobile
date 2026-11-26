/**
 * LS-945R6 C1 (growth-project-mobile#945 @ a0fe0331, inside fix commit a0fe0331; C, edge): the opening place now ends
 * with a scroll to the newest rows whenever it finds no row to open at (CommunitySpaceChatScreen.tsx:194-198). On a
 * fresh open that is where the list starts, unless she has already dragged: the place is chosen only once the read
 * line has answered (:180), and the rows of a space kept from earlier are on screen before that. A slow read line and
 * an early drag, and the list jumps back under her finger. At 300f3b33 (the fix out) nothing moved her.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { act, render } from '@testing-library/react-native';

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
type Pair = { onViewableItemsChanged: (info: unknown) => void };

it('LS945R6 C1: a fresh open whose read line answers after she has dragged up leaves her where she dragged', async () => {
  const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  const toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
  try {
    // A space kept from earlier: its rows are drawn at once; the read line has not answered yet.
    mockChat.readSettled = false;
    const r = await render(<Screen />);
    const list = () => r.getByTestId('space-chat-list');
    // She drags up to the oldest row before it answers.
    await act(async () => { list().props.onScrollBeginDrag?.(); });
    await act(async () => (list().props.viewabilityConfigCallbackPairs as Pair[])[0]
      .onViewableItemsChanged({ viewableItems: [{ key: 'row-1' }] }));
    expect(toIndex).not.toHaveBeenCalled();
    expect(toOffset).not.toHaveBeenCalled();
    // The read line answers: everything is read, so there is no row to open at.
    mockChat.readSettled = true;
    await r.rerender(<Screen />);
    await act(async () => { await new Promise((res) => setTimeout(res, 120)); });
    expect(toIndex).not.toHaveBeenCalled();
    expect(toOffset).not.toHaveBeenCalled();
  } finally {
    toIndex.mockRestore();
    toOffset.mockRestore();
  }
});
