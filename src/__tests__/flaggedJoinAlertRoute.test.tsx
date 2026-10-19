/**
 * M-FLAGROUTE (owner 61a): the flagged-client join alert opens that client's
 * consultation answers from a push and from the notification inbox. The row
 * copies backend b#943's write (src/onboarding/flagged-join-alert.ts) and
 * runs through the real push handler, normalizer, router and screens.
 * FLAG-2 (owner 139-12): the coached completion flag alert carries the same
 * link (backend flaggedClientPayload), and the screen is headed by the name
 * the read returns, since no alert row stores one (owner 4).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

/** Backend onboarding.service.ts coached completion alert, after FLAG-2. */
const COACHED_FLAG_ROW = {
  ...FLAGGED_JOIN_ROW,
  id: 'n-coached-flag',
  body: 'A new client finished their consultation and was flagged for extra care. Please review before their first session.',
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

/** The same alert as a push: the row's payload as the data. */
const pushResponse = (identifier: string) => ({
  notification: { request: { identifier, content: { data: { kind: 'coach_alert', ...FLAGGED_JOIN_ROW.payload } } } },
});

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

  it('push: a cold-start tap waits for the coach app, a background tap opens at once; both open the answers', async () => {
    let live: ((r: unknown) => void) | undefined;
    mockAddResponse.mockImplementation((cb: (r: unknown) => void) => {
      live = cb;
      return { remove: jest.fn() };
    });
    mockGetLast.mockResolvedValueOnce(pushResponse('push-cold'));
    const navigate = attachRoot(COACH_TABS);
    const cleanup = installNotificationResponseHandler(routePushTap);
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    setPushSession(COACH);
    live?.(pushResponse('push-live'));
    expect(navigate.mock.calls).toEqual([
      ['ClientsStack', OPEN_ANSWERS],
      ['ClientsStack', OPEN_ANSWERS],
    ]);
    cleanup();
  });

  it.each([
    ['the join alert', FLAGGED_JOIN_ROW],
    ['the coached completion alert (FLAG-2)', COACHED_FLAG_ROW],
  ])('notification inbox: tapping %s marks it read and opens the answers', async (_label, row) => {
    mockGet.mockImplementation(async (url: string) =>
      url.startsWith('/notifications/unread-count')
        ? { data: { count: 1 } }
        : { data: { items: [row], nextCursor: null } },
    );
    setPushSession(COACH);
    const navigate = attachRoot(COACH_TABS);
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText(row.body)).toBeTruthy());
    await fireEvent.press(screen.getByText(row.body));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('ClientsStack', OPEN_ANSWERS));
    expect(mockPost).toHaveBeenCalledWith(`/notifications/${row.id}/read`);
    expect(mockScreenNavigate).not.toHaveBeenCalled();
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

  const openAnswers = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ClientConsultationScreen route={{ key: 'k', name: 'ClientConsultation', params: OPEN_ANSWERS.params }} />
      </QueryClientProvider>,
    );

  it('the screen the tap opens reads that client\'s answers, headed by the name the read returns', async () => {
    const answer = { screen: 'B3', question: 'Your height and weight.', answer_label: '5 ft 6 in (168 cm), 172 lb' };
    let reply!: (res: unknown) => void;
    mockGet.mockReturnValueOnce(
      new Promise((resolve) => {
        reply = resolve;
      }),
    );
    const screen = await openAnswers();
    // FLAG-2: while the read loads, the heading holds its line, never "Client".
    expect(screen.getByTestId('consultation-loading')).toBeTruthy();
    expect(screen.queryByText('Client')).toBeNull();
    await act(async () =>
      reply({
        data: {
          version: 'consult-v1', revision: 1, revision_cause: 'complete',
          submitted_at: '2026-10-12T15:00:00.000Z', saved_at: '2026-10-12T15:00:00.000Z',
          chapters: [{ key: 'body', title: 'Body basics', answers: [answer] }],
          screening: { any_yes: false, items: [] },
          consent: { version: 'consult-consent-v3', agreed_at: '2026-10-12T14:00:00.000Z' },
          client_name: 'Sam Lee',
        },
      }),
    );
    await screen.findByTestId('consultation-answers');
    expect(mockGet).toHaveBeenCalledWith(`/coach/clients/${CLIENT}/consultation`);
    expect(screen.getByText(answer.answer_label)).toBeTruthy();
    expect(screen.getByRole('header').props.children).toBe('Sam Lee');
  });

  it('FLAG-2: a coach who lost access keeps the no-answers state and sees no name', async () => {
    mockGet.mockRejectedValueOnce(
      Object.assign(new Error('status 404'), {
        isAxiosError: true,
        config: { headers: {} },
        response: { status: 404, data: { message: 'Consultation not found' }, headers: {} },
      }),
    );
    const screen = await openAnswers();
    await screen.findByTestId('consultation-none');
    expect(screen.getByRole('header').props.children).toBe('Client');
    expect(screen.getByText('No consultation answers are on file for this client yet.')).toBeTruthy();
  });
});
