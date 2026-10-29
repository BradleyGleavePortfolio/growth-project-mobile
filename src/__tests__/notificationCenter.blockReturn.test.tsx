import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

const COACH = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const PRIVATE = 'Please call me about your private check-in.';
const MESSAGE = 'New message from Coach Avery';
const CONTROL = 'Your account update is ready.';
const mockGet = jest.fn();
const mockPost = jest.fn();
let mockFocused = true;
let mockServerBlocked = false;

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: jest.fn(),
  },
}));
jest.mock('../config/featureFlags', () => ({
  ...jest.requireActual('../config/featureFlags'),
  NOTIFICATIONS_MOCK_ENABLED: false,
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useIsFocused: () => mockFocused,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const R = require('react');
    R.useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('@expo/vector-icons', () => {
  const Icon = () => null;
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: (props: { testID?: string }) => R.createElement(View, props) };
});
jest.mock('../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../theme/tokens');
  const colors = jest.requireActual('../constants/colors').default;
  return {
    useTheme: () => ({ colors, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light' }),
  };
});
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: '22222222-2222-4222-8222-222222222222', role: 'student' }),
}));

import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import { messagesModerationApi } from '../api/messagesApi';
import { useBlockedUsersStore } from '../store/blockedUsersStore';

const ROWS = [
  {
    id: 'nudge-1', kind: 'coach_nudge', channel: 'inapp', body: PRIVATE,
    payload: { title: 'Message from your coach', coach_id: COACH, nudge_id: 'nudge-id' },
    deep_link: null, read_at: null, created_at: '2026-10-28T18:00:00.000Z',
  },
  {
    id: 'message-1', kind: 'message_received', channel: 'inapp', body: MESSAGE,
    payload: {}, deep_link: `tgp://messages/${CLIENT}`,
    read_at: null, created_at: '2026-10-28T18:00:00.000Z',
  },
  {
    id: 'control-1', kind: 'system', channel: 'inapp', body: CONTROL,
    payload: {}, deep_link: null, read_at: null, created_at: '2026-10-28T18:00:00.000Z',
  },
];

describe('B-LSNOTIFY4-B1171-1: returning to the loaded notification centre after a successful block', () => {
  beforeEach(() => {
    mockFocused = true;
    mockServerBlocked = false;
    mockGet.mockReset();
    mockPost.mockReset();
    useBlockedUsersStore.setState({ blocked: [], hydrated: true, userId: CLIENT });
    // These are the backend #1171 answers, whose real-DB block behavior passed.
    // After the block, a fresh read contains neither named coaching row.
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/notifications') {
        return { data: { items: mockServerBlocked ? [ROWS[2]] : ROWS, nextCursor: null } };
      }
      if (url === '/notifications/unread-count') {
        return { data: { count: mockServerBlocked ? 1 : 3 } };
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    mockPost.mockImplementation(async (url: string) => {
      if (url !== `/users/${COACH}/block`) throw new Error('Unexpected test mutation');
      mockServerBlocked = true;
      return { data: { ok: true } };
    });
  });

  it('does not retain the blocked coach words when the existing centre regains focus; unrelated rows stay', async () => {
    const view = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(view.getByText(PRIVATE)).toBeTruthy());
    expect(view.getByText(MESSAGE)).toBeTruthy();
    expect(view.getByText(CONTROL)).toBeTruthy();

    // The real Home stack keeps this screen mounted when a message row opens
    // Messages -> ContactView. ContactView's successful block goes back once;
    // Back from Messages then returns to this existing centre, not a new mount.
    mockFocused = false;
    await view.rerender(<NotificationCenterScreen />);
    await act(async () => { await messagesModerationApi.block(COACH); });
    expect(useBlockedUsersStore.getState().isBlocked(COACH)).toBe(true);
    expect(mockServerBlocked).toBe(true);

    mockFocused = true;
    await view.rerender(<NotificationCenterScreen />);
    await waitFor(() => expect(view.queryByText(PRIVATE)).toBeNull());
    expect(view.queryByText(MESSAGE)).toBeNull();
    expect(view.getByText(CONTROL)).toBeTruthy();
    await view.unmount();
  });
});
