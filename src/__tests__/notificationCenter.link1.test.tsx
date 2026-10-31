/**
 * LINK1 (B-LSNOTIFY5-M898-LINK1): every kind of row the Notification center draws, read and unread,
 * through the real normalizer, the real NotificationCenterScreen and the real push router.
 * A row is a button with "Open notification" exactly when a tap goes somewhere (notificationOpens);
 * a read row that goes nowhere stays plain text; an unread row always marks itself read.
 * Only HTTP, navigation hooks, icons and the theme are stubbed. Ids and names are fictional.
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
import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  setPushSession,
  type PushNavigator,
} from '../services/pushTapRouter';
import NotificationCenterScreen, {
  notificationOpens,
  routeNotification,
} from '../screens/notifications/NotificationCenterScreen';

const CLIENT_ID = '137c1340-c8a2-45d6-a006-7a6e695ed845';
const READ_AT = '2026-10-28T18:01:00.000Z';
const base = { read_at: READ_AT, created_at: '2026-10-28T18:00:00.000Z' };

/** The class: one row of each kind the center draws, with whether a tap goes somewhere. */
const ROWS: Array<{ raw: Record<string, unknown>; opens: boolean }> = [
  { opens: true, raw: { ...base, id: 'r-first-payment', kind: 'first_payment', body: 'First payment row.',
    deep_link: `tgp://coach/clients/${CLIENT_ID}`, payload: { amount: 4900, currency: 'usd', clientId: CLIENT_ID } } },
  { opens: true, raw: { ...base, id: 'r-web-link', kind: 'system', body: 'Web app link row.',
    deep_link: 'https://app.trygrowthproject.com/coach/alerts', payload: {} } },
  { opens: true, raw: { ...base, id: 'r-inbox-fallback-link', kind: 'system', body: 'Inbox fallback with a link row.',
    deep_link: 'tgp://coach/alerts', payload: { actionScreen: 'NotificationCenter' } } },
  { opens: true, raw: { ...base, id: 'r-safety', kind: 'coach_alert', body: 'Safety alert row.',
    deep_link: 'tgp://coach/alerts', payload: { actionScreen: 'CoachSafetyAlert', actionParams: { alertId: 'a-1' } } } },
  { opens: true, raw: { ...base, id: 'r-booking', kind: 'system', body: 'Booking row.',
    payload: { actionScreen: 'CoachBookingInbox', actionParams: { sessionId: 's-1' } } } },
  { opens: true, raw: { ...base, id: 'r-message', kind: 'message_received', body: 'Message row.', payload: {} } },
  { opens: true, raw: { ...base, id: 'r-community', kind: 'community_reply', body: 'Community row.', payload: {} } },
  { opens: true, raw: { ...base, id: 'r-workout', kind: 'workout_assigned', body: 'Workout row.', payload: {} } },
  { opens: true, raw: { ...base, id: 'r-drip', kind: 'drip_released', body: 'Drip row.', payload: { client_purchase_id: 'cp-1' } } },
  { opens: true, raw: { ...base, id: 'r-blocker', kind: 'dunning_blocker', body: 'Blocker row.',
    payload: { headline: 'Blocker headline' } } },
  { opens: false, raw: { ...base, id: 'r-refund', kind: 'dunning_blocker', body: 'Refund notice row.', payload: {} } },
  { opens: false, raw: { ...base, id: 'r-plain', kind: 'system', body: 'Plain row.', payload: {} } },
  { opens: false, raw: { ...base, id: 'r-sign-in-link', kind: 'system', body: 'Sign-in link row.',
    deep_link: 'tgp://login', payload: {} } },
  { opens: false, raw: { ...base, id: 'r-foreign-link', kind: 'system', body: 'Foreign link row.',
    deep_link: 'https://elsewhere.example/coach/alerts', payload: {} } },
  // routePushTap drops a row whose link it cannot read, even with a screen name: the row says so.
  { opens: false, raw: { ...base, id: 'r-screen-bad-link', kind: 'system', body: 'Screen with a bad link row.',
    deep_link: 'not a link', payload: { actionScreen: 'Messages' } } },
];

const COACH_TABS = ['CommandCenter', 'ClientsStack', 'Templates', 'Messages', 'SettingsStack'];

function attachCoach(): jest.Mock {
  setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' });
  const navigate = jest.fn();
  const nav: PushNavigator = { isReady: () => true, navigate, getRootState: () => ({ routeNames: COACH_TABS }) };
  attachPushNavigator(nav);
  return navigate;
}

function serve(rows: unknown[], unread: number) {
  mockGet.mockImplementation(async (url: string) =>
    url.startsWith('/notifications/unread-count')
      ? { data: { count: unread } }
      : { data: { items: rows, nextCursor: null } },
  );
}

const bodyOf = (raw: Record<string, unknown>) => raw.body as string;
// The list draws its first ten rows at once; the class is checked eight rows per render.
const CHUNKS = [ROWS.slice(0, 8), ROWS.slice(8)];

beforeEach(() => {
  __resetPushTapRouterForTests();
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: {} });
  mockScreenNavigate.mockReset();
});

describe('LINK1: a row opens exactly when its tap goes somewhere', () => {
  it('the predicate answers for every kind of row, and agrees with the tap handler', () => {
    for (const { raw, opens } of ROWS) {
      const n = normalizeNotification(raw);
      expect(n).not.toBeNull();
      expect([raw.id, notificationOpens(n!)]).toEqual([raw.id, opens]);
      __resetPushTapRouterForTests();
      const navigate = attachCoach();
      routeNotification(n!, { navigate: mockScreenNavigate });
      const went = navigate.mock.calls.length + mockScreenNavigate.mock.calls.length > 0;
      expect([raw.id, went]).toEqual([raw.id, opens]);
      mockScreenNavigate.mockReset();
    }
  });

  it('read rows: a destination makes a button with "Open notification"; none leaves plain text', async () => {
    for (const chunk of CHUNKS) {
      serve(chunk.map((r) => r.raw), 0);
      attachCoach();
      const screen = await render(<NotificationCenterScreen />);
      await waitFor(() => expect(screen.getByText(bodyOf(chunk[0].raw))).toBeTruthy());
      for (const { raw, opens } of chunk) {
        const row = screen.getByLabelText(new RegExp(`${bodyOf(raw).replace('.', '\\.')}$`));
        expect([raw.id, row.props.accessibilityRole, row.props.accessibilityHint])
          .toEqual([raw.id, opens ? 'button' : 'text', opens ? 'Open notification' : undefined]);
        expect([raw.id, row.props.accessibilityState?.disabled ?? false]).toEqual([raw.id, !opens]);
      }
      await screen.unmount();
    }
  });

  it('a read first-payment row opens that client again, with no read call', async () => {
    serve([ROWS[0].raw], 0);
    const navigate = attachCoach();
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText('First payment row.')).toBeTruthy());
    await fireEvent.press(screen.getByText('First payment row.'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('ClientsStack', {
      screen: 'ClientDetail', params: { clientId: CLIENT_ID, clientName: '' }, initial: false,
    }));
    expect(mockPost).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('a read row with nowhere to go does nothing when pressed', async () => {
    const plain = ROWS.find((r) => r.raw.id === 'r-plain')!.raw;
    serve([plain], 0);
    const navigate = attachCoach();
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText('Plain row.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Plain row.'));
    expect(navigate).not.toHaveBeenCalled();
    expect(mockScreenNavigate).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('unread rows stay buttons that mark themselves read; the hint says where the tap goes', async () => {
    for (const chunk of CHUNKS) {
      serve(chunk.map((r) => ({ ...r.raw, read_at: null })), chunk.length);
      attachCoach();
      const screen = await render(<NotificationCenterScreen />);
      await waitFor(() => expect(screen.getByText(bodyOf(chunk[0].raw))).toBeTruthy());
      for (const { raw, opens } of chunk) {
        const row = screen.getByLabelText(new RegExp(`^Unread\\. .*${bodyOf(raw).replace('.', '\\.')}$`));
        expect([raw.id, row.props.accessibilityRole, row.props.accessibilityHint])
          .toEqual([raw.id, 'button', opens ? 'Open notification' : 'Mark as read']);
        expect([raw.id, row.props.accessibilityState?.disabled ?? false]).toEqual([raw.id, false]);
      }
      if (chunk.some((r) => r.raw.id === 'r-plain')) {
        await fireEvent.press(screen.getByText('Plain row.'));
        await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/notifications/r-plain/read'));
      }
      await screen.unmount();
    }
    expect(mockPost).toHaveBeenCalledWith('/notifications/r-plain/read');
  });
});
