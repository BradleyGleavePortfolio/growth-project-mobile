import React from 'react';
import { FlatList } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { CommonActions, StackRouter } from '@react-navigation/routers';

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
    data: { cohorts: ['space-a', 'space-b'].map((id) => ({ id, name: id, member_count: 4, my_role: 'client' })) },
    isLoading: false, isError: false,
  }),
}));
const mockMarkRead = jest.fn(async () => true);
const mockChats = Object.fromEntries(['space-a', 'space-b'].map((id, n) => [id, {
  messages: [3, 2, 1].map((k) => ({
    id: `${id}-${k}`, cohort_id: id, kind: 'text', body: `Row ${k}`, sender_user_id: 'author',
    created_at: `2026-11-${n ? '01' : '10'}T10:0${k}:00.000Z`, sender: { name: 'Author' },
  })),
  list: { isSuccess: true, isLoading: false, isError: false, hasNextPage: false, data: { pages: [{}] } },
  pending: [], noAccess: false, readSettled: true, readCursor: null,
  reply: null, held: null, setReply: jest.fn(), setHeld: jest.fn(), readable: jest.fn(),
  markRead: (messageId: string) => mockMarkRead(id, messageId),
}]));
jest.mock('../../../components/community/space-chat/useSpaceChat', () => ({
  useSpaceChat: (id: string) => mockChats[id],
}));
jest.mock('../../../components/community/space-chat/useSpaceVoiceOutbox', () => ({
  useSpaceVoiceOutbox: () => ({ rows: [] }),
}));
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
    spaceDay: () => 'Today', SMALL_GREY: '#2C2C2C', PHOTO_WORD: 'Photo',
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const Screen = require('../CommunitySpaceChatScreen').default;
const router = StackRouter({ initialRouteName: 'CommunitySpaceChat' });
const options = {
  routeNames: ['CommunitySpaceChat'], routeParamList: {}, routeGetIdList: {},
};
const retarget = (params: { cohortId: string; messageId?: string }) => {
  const initial = router.getInitialState(options);
  const previous = { ...initial, routes: initial.routes.map((route) => ({ ...route, params: mockParams.current })) };
  const next = router.getStateForAction(previous, CommonActions.navigate('CommunitySpaceChat', params), options)!;
  expect(next.routes[0].key).toBe(previous.routes[0].key);
  mockParams.current = next.routes[0].params as typeof params;
};
const reportVisible = async (r: Awaited<ReturnType<typeof render>>, id: string) => {
  await act(async () => r.getByTestId('space-chat-list').props.viewabilityConfigCallbackPairs[0]
    .onViewableItemsChanged({ viewableItems: [{ key: id }] }));
};

beforeEach(() => {
  mockParams.current = { cohortId: 'space-a' };
  mockMarkRead.mockClear();
});

it('positive control: a message target on a newly mounted screen is placed', async () => {
  mockParams.current = { cohortId: 'space-a', messageId: 'space-a-1' };
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  try {
    await render(<Screen />);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ index: 2, viewPosition: 0.5, animated: false }));
  } finally {
    scroll.mockRestore();
  }
});

it.each(['space-a', 'space-b'])('LS945 B1: a new message link into mounted %s is placed at its target', async (cohortId) => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  try {
    const r = await render(<Screen />);
    await reportVisible(r, 'space-a-3');
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('space-a', 'space-a-3'));
    scroll.mockClear();
    retarget({ cohortId, messageId: `${cohortId}-1` });
    await r.rerender(<Screen />);
    const data = r.getByTestId('space-chat-list').props.data as Array<{ key: string }>;
    const index = data.findIndex((row) => row.key === `${cohortId}-1`);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ index, viewPosition: 0.5, animated: false }));
  } finally {
    scroll.mockRestore();
  }
});

it('LS945 B1: changing spaces resets the read watermark even when the second space has older messages', async () => {
  const r = await render(<Screen />);
  await reportVisible(r, 'space-a-3');
  await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('space-a', 'space-a-3'));
  retarget({ cohortId: 'space-b' });
  await r.rerender(<Screen />);
  await reportVisible(r, 'space-b-3');
  await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('space-b', 'space-b-3'));
});
