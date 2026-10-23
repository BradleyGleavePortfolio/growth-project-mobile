/**
 * SWITCH-TELL-M: the former coach's one in-app row when a client moves to the
 * house coach (backend b#1132, CONTRACT 6348078315 item 1: kind
 * coach_client_moved, channel inapp, deep_link null, payload { client_id }).
 * The row is the server body as its one line: no "Update" title, no second
 * line, no tap destination. Runs the real normalizer and the real
 * NotificationCenterScreen; only HTTP, navigation hooks, icons and the theme
 * are stubbed. Names are fictional.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    patch: jest.fn(),
    put: jest.fn(),
  },
}));
jest.mock('../config/featureFlags', () => ({
  ...jest.requireActual('../config/featureFlags'),
  NOTIFICATIONS_MOCK_ENABLED: false,
}));
const mockScreenNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockScreenNavigate, goBack: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }),
  useRoute: () => ({ params: undefined }),
  useFocusEffect: () => undefined,
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

import { normalizeNotification } from '../services/notificationsApi';
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';

const BODY = 'Sam Lee has moved to another coach.';
const MOVED_ROW = {
  id: 'n-moved',
  kind: 'coach_client_moved',
  title: null,
  body: BODY,
  payload: { client_id: 'client-9' },
  deep_link: null,
  channel: 'inapp',
  read_at: null,
  created_at: '2026-10-22T17:00:00.000Z',
};

function serve(rows: unknown[]) {
  mockGet.mockImplementation(async (url: string) =>
    url.startsWith('/notifications/unread-count')
      ? { data: { count: rows.length } }
      : { data: { items: rows, nextCursor: null } },
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockScreenNavigate.mockReset();
});

describe('SWITCH-TELL-M: the client-moved row', () => {
  it('is the server sentence as its one line, with no destination and no client id', () => {
    const n = normalizeNotification(MOVED_ROW);
    expect(n).toEqual({
      id: 'n-moved',
      kind: 'system',
      title: BODY,
      body: '',
      read: false,
      createdAt: '2026-10-22T17:00:00.000Z',
    });
    // A payload that carries a screen or link still opens nothing.
    const linked = normalizeNotification({
      ...MOVED_ROW,
      payload: { client_id: 'client-9', actionScreen: 'CoachClientDetail', deepLink: 'tgp://coach/clients/client-9' },
    });
    expect(linked?.actionScreen).toBeUndefined();
    expect(linked?.deepLink).toBeUndefined();
    expect(JSON.stringify(linked)).not.toContain('client-9');
  });

  it('a blank body reads the approved fallback, and a read row stays read', () => {
    expect(normalizeNotification({ ...MOVED_ROW, body: '  ' })?.title).toBe('A client has moved to another coach.');
    expect(normalizeNotification({ ...MOVED_ROW, read_at: '2026-10-22T18:00:00.000Z' })?.read).toBe(true);
  });

  it('in the center: one line, never "Update"; a tap marks it read and goes nowhere', async () => {
    serve([MOVED_ROW]);
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText(BODY)).toBeTruthy());
    expect(screen.getAllByText(BODY)).toHaveLength(1);
    expect(screen.queryByText('Update')).toBeNull();
    expect(screen.getByLabelText(`Unread. ${BODY}`)).toBeTruthy();

    await fireEvent.press(screen.getByText(BODY));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/notifications/n-moved/read'));
    expect(mockScreenNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(BODY)).toBeTruthy());
  });

  it('other rows keep their title and body lines', async () => {
    serve([{ ...MOVED_ROW, id: 'n-other', kind: 'system', title: 'Heads up', body: 'Your week is ready.' }]);
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText('Heads up')).toBeTruthy());
    expect(screen.getByText('Your week is ready.')).toBeTruthy();
    expect(screen.getByLabelText('Unread. Heads up. Your week is ready.')).toBeTruthy();
  });
});
