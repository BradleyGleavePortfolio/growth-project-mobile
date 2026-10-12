/**
 * M-FLAGROUTE (owner 61a): tapping the flagged-client join alert opens that
 * client's consultation answers (Clients > ClientConsultation), with the
 * Clients list kept beneath so Back works.
 *
 * The row copies the backend's own write (backend main, b#943,
 * src/onboarding/flagged-join-alert.ts): kind coach_alert, channel inapp,
 * payload { type: 'onboarding_screening_review', client_id, actionScreen:
 * 'ClientConsultation', actionParams: { clientId } }. It runs through the
 * real push tap handler (pushNotifications.ts), the real normalizer
 * (notificationsApi.ts), the real router (pushTapRouter.ts), the real
 * NotificationCenterScreen and the real ClientConsultationScreen. Only HTTP,
 * expo-notifications, navigation hooks, icons and the theme are stubbed.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
// The live path (GET /notifications), whatever the local env says.
jest.mock('../config/featureFlags', () => ({
  ...jest.requireActual('../config/featureFlags'),
  NOTIFICATIONS_MOCK_ENABLED: false,
}));

const mockAddResponse = jest.fn();
const mockGetLast = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
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
jest.mock('../services/authActions', () => ({ signOut: jest.fn(() => Promise.resolve()) }));
jest.mock('../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
jest.mock('../components/support/SupportEmailFallback', () => ({
  useSupportEmail: () => ({ state: 'idle', open: jest.fn(), copy: jest.fn() }),
  SupportEmailFallback: () => null,
}));

import { normalizeNotification } from '../services/notificationsApi';
import { installNotificationResponseHandler } from '../services/pushNotifications';
import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  routeInAppNotification,
  routePushTap,
  setPushSession,
  type PushNavigator,
} from '../services/pushTapRouter';
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import ClientConsultationScreen from '../screens/coach/ClientConsultationScreen';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const BODY =
  'A client who just joined you was flagged for extra care in their consultation. Please review their answers before their first session.';

/** backend b#943 alertCoachOfFlaggedJoinTx, as GET /notifications returns it. */
const FLAGGED_JOIN_ROW = {
  id: 'n-flagged-join',
  user_id: 'coach-1',
  kind: 'coach_alert',
  channel: 'inapp',
  body: BODY,
  payload: {
    type: 'onboarding_screening_review',
    client_id: CLIENT,
    actionScreen: 'ClientConsultation',
    actionParams: { clientId: CLIENT },
  },
  deep_link: null,
  read_at: null,
  created_at: '2026-10-12T17:00:00.000Z',
};

/** What every tap path delivers: the answers, the Clients list beneath. */
const OPEN_ANSWERS = { screen: 'ClientConsultation', params: { clientId: CLIENT }, initial: false };

const COACH_TABS = ['CommandCenter', 'ClientsStack', 'Templates', 'Messages', 'SettingsStack'];
const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab'];
const COACH = { kind: 'app', userId: 'coach-1', role: 'coach' } as const;

function attachRoot(routeNames: string[]): jest.Mock {
  const navigate = jest.fn();
  const nav: PushNavigator = { isReady: () => true, navigate, getRootState: () => ({ routeNames }) };
  attachPushNavigator(nav);
  return navigate;
}

/** The push the alert would arrive as: the row's payload as the data. */
function pushResponse(id: string) {
  const { actionScreen, actionParams } = FLAGGED_JOIN_ROW.payload;
  return {
    notification: {
      request: { identifier: id, content: { data: { kind: 'coach_alert', actionScreen, actionParams } } },
    },
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('owner 61a: the flagged-client join alert opens that client\'s answers', () => {
  beforeEach(() => {
    __resetPushTapRouterForTests();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {} });
    mockScreenNavigate.mockReset();
    mockAddResponse.mockReset();
    mockGetLast.mockReset();
    mockGetLast.mockResolvedValue(null);
  });

  it('the inbox row keeps its link to that client, and its wording is unchanged', () => {
    const n = normalizeNotification(FLAGGED_JOIN_ROW);
    expect(n?.actionScreen).toBe('ClientConsultation');
    expect(n?.actionParams).toEqual({ clientId: CLIENT });
    expect(n?.body).toBe(BODY);
    expect(n?.title).toBe('Update');
  });

  it('push tapped while the app runs in the background: the tap opens the answers', async () => {
    let live: ((r: unknown) => void) | undefined;
    mockAddResponse.mockImplementation((cb: (r: unknown) => void) => {
      live = cb;
      return { remove: jest.fn() };
    });
    setPushSession(COACH);
    const navigate = attachRoot(COACH_TABS);
    const cleanup = installNotificationResponseHandler(routePushTap);
    await flush();
    live?.(pushResponse('push-1'));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('ClientsStack', OPEN_ANSWERS);
    cleanup();
  });

  it('push that cold-starts the app: held until the coach app is mounted, then opens the answers', async () => {
    mockAddResponse.mockImplementation(() => ({ remove: jest.fn() }));
    mockGetLast.mockResolvedValueOnce(pushResponse('push-cold'));
    const navigate = attachRoot(COACH_TABS);
    const cleanup = installNotificationResponseHandler(routePushTap);
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    setPushSession(COACH);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('ClientsStack', OPEN_ANSWERS);
    cleanup();
  });

  it('notification inbox: tapping the row marks it read and opens the answers', async () => {
    mockGet.mockImplementation(async (url: string) =>
      url.startsWith('/notifications/unread-count')
        ? { data: { count: 1 } }
        : { data: { items: [FLAGGED_JOIN_ROW], nextCursor: null } },
    );
    setPushSession(COACH);
    const navigate = attachRoot(COACH_TABS);
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText(BODY)).toBeTruthy());
    await fireEvent.press(screen.getByText(BODY));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('ClientsStack', OPEN_ANSWERS));
    expect(mockPost).toHaveBeenCalledWith('/notifications/n-flagged-join/read');
    expect(mockScreenNavigate).not.toHaveBeenCalled();
  });

  it('notification inbox before the app navigator is ready: the row still opens the answers', async () => {
    mockGet.mockImplementation(async (url: string) =>
      url.startsWith('/notifications/unread-count')
        ? { data: { count: 1 } }
        : { data: { items: [FLAGGED_JOIN_ROW], nextCursor: null } },
    );
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText(BODY)).toBeTruthy());
    await fireEvent.press(screen.getByText(BODY));
    await waitFor(() =>
      expect(mockScreenNavigate).toHaveBeenCalledWith('ClientConsultation', { clientId: CLIENT }),
    );
  });

  it('a client account is never sent to the coach screen', () => {
    setPushSession({ kind: 'app', userId: 'client-1', role: 'student' });
    const navigate = attachRoot(CLIENT_TABS);
    expect(routeInAppNotification('ClientConsultation', { clientId: CLIENT })).toBe(true);
    routePushTap('ClientConsultation', { clientId: CLIENT }, 'push-2');
    expect(navigate).toHaveBeenCalledTimes(2);
    for (const [root, opts] of navigate.mock.calls) {
      expect(root).toBe('Home');
      expect(opts).toEqual(expect.objectContaining({ screen: 'NotificationCenter' }));
    }
  });

  it('the screen the tap opens reads that client\'s answers', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        version: 'consult-v1',
        revision: 1,
        revision_cause: 'complete',
        submitted_at: '2026-10-12T15:00:00.000Z',
        saved_at: '2026-10-12T15:00:00.000Z',
        chapters: [
          {
            key: 'body',
            title: 'Body basics',
            answers: [{ screen: 'B3', question: 'Your height and weight.', answer_label: '5 ft 6 in (168 cm), 172 lb' }],
          },
        ],
        screening: {
          any_yes: true,
          items: [{ key: 'P2', question: 'Has a joint ever stopped you training?', answer: 'yes', note: null }],
        },
        consent: { version: 'consult-consent-v3', agreed_at: '2026-10-12T14:00:00.000Z' },
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={qc}>
        <ClientConsultationScreen route={{ key: 'k', name: 'ClientConsultation', params: OPEN_ANSWERS.params }} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('consultation-answers');
    expect(mockGet).toHaveBeenCalledWith(`/coach/clients/${CLIENT}/consultation`);
    expect(screen.getByText('Has a joint ever stopped you training?')).toBeTruthy();
    expect(screen.getByText('5 ft 6 in (168 cm), 172 lb')).toBeTruthy();
  });
});
