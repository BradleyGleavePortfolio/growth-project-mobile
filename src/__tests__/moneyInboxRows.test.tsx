/**
 * MONEY-INBOX-130: money and purchase rows in the Notification center.
 *
 * The rows below copy the backend's own writes (backend main 272dc8ef):
 *   drip_released       drip-dispatcher.cron.ts:490-518 (package-push.service.ts:691-718, same shape)
 *   dunning_blocker     dunning-v2.dispatcher.ts:298-311 (Day 3, Day 7, dispute) and
 *                       refund-dispute-handler.service.ts:517-524 (full refund)
 *   trial_ending        trial-notice.service.ts:434-452
 *   coach_new_purchase  purchase-fanout.service.ts:694-714
 * They run through the real normalizer (notificationsApi.ts), the real push
 * and in-app router (pushTapRouter.ts), the real NotificationCenterScreen and
 * the real DeliverablesScreen. Only HTTP, navigation hooks, icons and the
 * theme are stubbed. Names and amounts are fictional.
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
// The live path (GET /notifications), whatever the local env says.
jest.mock('../config/featureFlags', () => ({
  ...jest.requireActual('../config/featureFlags'),
  NOTIFICATIONS_MOCK_ENABLED: false,
}));

const mockScreenNavigate = jest.fn();
let mockRouteParams: Record<string, string> | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockScreenNavigate, goBack: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }),
  useRoute: () => ({ params: mockRouteParams }),
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
const mockGetPurchaseDrops = jest.fn();
jest.mock('../api/clientPaymentsApi', () => {
  const actual = jest.requireActual('../api/clientPaymentsApi');
  return {
    ...actual,
    clientPaymentsApi: { ...actual.clientPaymentsApi, getPurchaseDrops: (...a: unknown[]) => mockGetPurchaseDrops(...a) },
  };
});
jest.mock('../screens/client/deliverables/openPurchasedMedia', () => ({ openPurchasedMedia: jest.fn() }));

import { normalizeNotification } from '../services/notificationsApi';
import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  routeInAppNotification,
  routePushTap,
  setPushSession,
  type PushNavigator,
} from '../services/pushTapRouter';
import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';
import DeliverablesScreen from '../screens/client/DeliverablesScreen';

const CREATED = '2026-10-07T17:00:00.000Z';

const DRIP_ROW = {
  id: 'n-drip',
  kind: 'drip_released',
  body: 'New content unlocked: Week 2 program',
  payload: {
    scheduled_drop_id: 'drop-2',
    client_purchase_id: 'cp-1',
    asset_type: 'workout_program',
    asset_id: 'prog-2',
    content_id: 'content-2',
  },
  deep_link: 'tgp://client/library',
  channel: 'inapp',
  read_at: null,
  created_at: CREATED,
};

const blockerRow = (id: string, variant: string, headline: string, primaryCta: string, body: string) => ({
  id,
  kind: 'dunning_blocker',
  body,
  payload: { headline, primaryCta, secondaryCta: 'Not now', variant, dunningStateId: 'ds-1' },
  deep_link: 'tgp://billing/update',
  channel: 'inapp',
  read_at: null,
  created_at: CREATED,
});
const BLOCKER_DAY3_ROW = blockerRow(
  'n-blocker-3', 'day3', 'You are going to lose access.', 'Update Payment',
  'Your payment of $120.00 has not cleared, Sam. A new card is charged the amount owed; once that goes through, you keep everything.',
);
const BLOCKER_DAY7_ROW = blockerRow(
  'n-blocker-7', 'day7', 'Last chance before lockout.', 'Update Payment',
  'Your payment of $120.00 is still unpaid, Sam. Access locks on Oct 14. A new card is charged; once that clears, you keep everything.',
);
const BLOCKER_DISPUTE_ROW = blockerRow(
  'n-blocker-lr', 'lr_day3', 'The bank opened a dispute or inquiry about a payment.', 'See details',
  'The bank opened a dispute or inquiry about a recent payment. Access has ended and billing is paused. Restarting it is up to Alex.',
);

const REFUND_ROW = {
  id: 'n-refund',
  kind: 'dunning_blocker',
  body: 'A full refund was completed for this plan. Access to the plan has ended and billing is paused. The coach decides whether to restart it.',
  payload: { event: 'full_refund_paused', purchase_id: 'cp-1' },
  channel: 'inapp',
  read_at: null,
  created_at: CREATED,
};

const TRIAL_ROW = {
  id: 'n-trial',
  kind: 'trial_ending',
  body: 'Your free trial ends on Oct 10. Your card will be charged $120.00 then. Cancel anytime before.',
  deep_link: 'tgp://plan',
  channel: 'inapp',
  payload: {
    actionScreen: 'ClientPackages',
    purchase_id: 'cp-3',
    package_id: 'pkg-3',
    trial_ends_at: '2026-10-10T17:00:00.000Z',
    amount_cents: 12000,
    currency: 'usd',
    will_charge: true,
    card_on_file: true,
  },
  read_at: null,
  created_at: CREATED,
};

const COACH_PURCHASE_ROW = {
  id: 'n-purchase',
  kind: 'coach_new_purchase',
  body: 'Sam just bought Strength Block ($120.00)',
  payload: { purchase_id: 'cp-1', buyer_id: 'client-1', package_name: 'Strength Block', amount_cents: 12000, currency: 'usd' },
  deep_link: 'tgp://coach/purchases/cp-1',
  channel: 'inapp',
  read_at: null,
  created_at: CREATED,
};

const FIRED_DROP = {
  id: 'drop-2',
  asset_type: 'workout_program',
  asset_id: 'prog-2',
  asset_revision_id: null,
  cadence_kind: 'immediate',
  display_title: 'Week 2 program',
  display_caption: null,
  fire_at: null,
  fired_at: CREATED,
  status: 'fired',
  materialised_ref: 'assignment-2',
};

const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab'];
const COACH_TABS = ['CommandCenter', 'ClientsStack', 'Templates', 'Messages', 'SettingsStack'];

function attachRoot(routeNames: string[]): jest.Mock {
  const navigate = jest.fn();
  const nav: PushNavigator = { isReady: () => true, navigate, getRootState: () => ({ routeNames }) };
  attachPushNavigator(nav);
  return navigate;
}

const UPDATE_CARD = { screen: 'UpdateCard', params: undefined, initial: false };

describe('MONEY-INBOX-130: money rows in the Notification center', () => {
  beforeEach(() => {
    __resetPushTapRouterForTests();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {} });
    mockScreenNavigate.mockReset();
    mockGetPurchaseDrops.mockReset();
    mockRouteParams = undefined;
  });

  it('each money row is titled for what it is, never "Update"', () => {
    expect(normalizeNotification(DRIP_ROW)?.title).toBe('New content');
    expect(normalizeNotification(TRIAL_ROW)?.title).toBe('Your free trial');
    expect(normalizeNotification(BLOCKER_DAY3_ROW)?.title).toBe('You are going to lose access.');
    expect(normalizeNotification(BLOCKER_DAY7_ROW)?.title).toBe('Last chance before lockout.');
    expect(normalizeNotification(BLOCKER_DISPUTE_ROW)?.title).toBe('The bank opened a dispute or inquiry about a payment.');
    expect(normalizeNotification(REFUND_ROW)?.title).toBe('Payment');
    expect(normalizeNotification(COACH_PURCHASE_ROW)?.title).toBe('New purchase');
    // A title the row carries itself still wins.
    const titled = { ...DRIP_ROW, payload: { ...DRIP_ROW.payload, title: 'Week 2 is ready' } };
    expect(normalizeNotification(titled)?.title).toBe('Week 2 is ready');
  });

  it('"New content unlocked" opens the Deliverables of the purchase it belongs to', () => {
    const n = normalizeNotification(DRIP_ROW);
    expect(n?.actionScreen).toBe('Deliverables');
    expect(n?.actionParams).toEqual({ purchaseId: 'cp-1' });
    // Params the row carries itself still win.
    const own = { ...DRIP_ROW, payload: { ...DRIP_ROW.payload, actionParams: { purchaseId: 'cp-9' } } };
    expect(normalizeNotification(own)?.actionParams).toEqual({ purchaseId: 'cp-9' });
  });

  it('the Day 3, Day 7 and dispute blockers open the card screen; the full-refund notice stays a plain row', () => {
    for (const row of [BLOCKER_DAY3_ROW, BLOCKER_DAY7_ROW, BLOCKER_DISPUTE_ROW]) {
      const n = normalizeNotification(row);
      expect(n?.actionScreen).toBe('UpdateCard');
      expect(n?.actionParams).toBeUndefined();
    }
    expect(normalizeNotification(REFUND_ROW)?.actionScreen).toBeUndefined();
  });

  it('a client push naming UpdateCard opens the card screen in the You stack, its index kept beneath', () => {
    setPushSession({ kind: 'app', userId: 'client-1', role: 'student' });
    const navigate = attachRoot(CLIENT_TABS);
    routePushTap('UpdateCard', undefined, 'push-1');
    expect(navigate).toHaveBeenCalledWith('MoreTab', UPDATE_CARD);
  });

  it('a coach is never sent to the client card screen', () => {
    setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' });
    const navigate = attachRoot(COACH_TABS);
    expect(routeInAppNotification('UpdateCard')).toBe(true);
    expect(navigate).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', params: undefined });
  });

  it('in the center the rows carry their titles; tapping opens Deliverables for the purchase and the card screen', async () => {
    mockGet.mockImplementation(async (url: string) =>
      url.startsWith('/notifications/unread-count')
        ? { data: { count: 3 } }
        : { data: { items: [DRIP_ROW, BLOCKER_DAY3_ROW, TRIAL_ROW], nextCursor: null } },
    );
    setPushSession({ kind: 'app', userId: 'client-1', role: 'student' });
    const navigate = attachRoot(CLIENT_TABS);
    const screen = await render(<NotificationCenterScreen />);
    await waitFor(() => expect(screen.getByText('New content')).toBeTruthy());
    expect(screen.getByText('You are going to lose access.')).toBeTruthy();
    expect(screen.getByText('Your free trial')).toBeTruthy();
    expect(screen.queryByText('Update')).toBeNull();

    await fireEvent.press(screen.getByText('New content'));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('MoreTab', { screen: 'Deliverables', params: { purchaseId: 'cp-1' } }),
    );
    expect(mockPost).toHaveBeenCalledWith('/notifications/n-drip/read');

    await fireEvent.press(screen.getByText('You are going to lose access.'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('MoreTab', UPDATE_CARD));
    expect(mockPost).toHaveBeenCalledWith('/notifications/n-blocker-3/read');
    expect(mockScreenNavigate).not.toHaveBeenCalled();
  });

  it('Deliverables opened from the row lists what was bought, not "No content is listed for this purchase."', async () => {
    mockRouteParams = normalizeNotification(DRIP_ROW)?.actionParams;
    mockGetPurchaseDrops.mockResolvedValue({ ok: true, data: [FIRED_DROP] });
    const screen = await render(<DeliverablesScreen />);
    await waitFor(() => expect(screen.getByTestId('deliverables-list')).toBeTruthy());
    expect(mockGetPurchaseDrops).toHaveBeenCalledWith('cp-1');
    expect(screen.getByText('Week 2 program')).toBeTruthy();
    expect(screen.queryByText('No content is listed for this purchase.')).toBeNull();
  });
});
