/**
 * REFINE-966, #203-E45 (1) to (3): B1 no banner for the screen already open, B2 a safety card stays until closed, B3
 * pushes that arrive while a card shows become one card with a count. Real listener (pushNotifications), store,
 * banner and router; expo-notifications mocked at its edge (as foregroundBannerTap.test.tsx); the banner sits in a
 * container whose focused route each case sets. Every row's data is copied key for key from its backend sender at
 * growth-project-backend 7f566a59c19abd9bb9df42c5680bd13db0b971d5 (cited): a template push's data is pushTapData
 * (notifications.service.ts:1122-1161) plus kind (push/push-delivery.service.ts:717); a sender's own push carries the
 * data it was sent with. Every switch on ([R27]). Titles and bodies are ordinary stand-ins.
 */
import React from 'react';
import { Animated, PanResponder } from 'react-native';
import { NavigationContainerRefContext } from '@react-navigation/native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';

const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockDismiss = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  dismissNotificationAsync: (...a: unknown[]) => mockDismiss(...a),
  dismissAllNotificationsAsync: (...a: unknown[]) => mockDismiss(...a),
  AndroidImportance: { MAX: 5 },
}));
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) => (typeof Reflect.get(t, k) === 'boolean' ? true : Reflect.get(t, k)),
    }),
  };
});
jest.mock('../../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colors: {}, semanticColors: tokens.lightTokens, tokens: tokens.default }) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../services/pushTapRouter', () => {
  const actual = jest.requireActual('../../services/pushTapRouter');
  return { ...actual, routePushTap: jest.fn((...a: unknown[]) => actual.routePushTap(...a)) };
});
// The Notifications list is the server's rows (NotificationCenterScreen.tsx fetchNotifications); its writes recorded.
jest.mock('../../services/notificationsApi', () => {
  const actual = jest.requireActual('../../services/notificationsApi');
  return { ...actual, markNotificationRead: jest.fn(), markAllNotificationsRead: jest.fn(), fetchNotifications: jest.fn() };
});

import ForegroundNotificationBanner from '../ForegroundNotificationBanner';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';
import { installForegroundHandler, installNotificationResponseHandler, pushTapOf } from '../../services/pushNotifications';
import {
  __resetPushTapRouterForTests, attachPushNavigator, pushTapLanding, routePushTap, setPushSession, type PushRole,
} from '../../services/pushTapRouter';
import * as notificationsApi from '../../services/notificationsApi';

const CLIENT = '0b9a2a52-6f0e-4c39-9d43-2f1f3c1f6a01';
const OTHER_CLIENT = '4d3c2b1a-0f9e-4d8c-9b7a-6f5e4d3c2b1a';
const COACH = 'b1c2d3e4-0000-4000-8000-00000000c0a1';
const SESSION = '5d1c7a40-2b0e-4f6e-9a51-6c1f0e2a7b11';
const ASSIGNMENT = '7f3e9d20-1c4b-4a8e-b2f6-0d9c8e7a6b51';
const COHORT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MESSAGE = '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a99';
const POST = '2b1a0f9e-8d7c-4b6a-9e5d-4c3b2a1f0e9d';
const PURCHASE = '6e5d4c3b-2a19-4f8e-9d7c-6b5a4e3d2c1b';
const ALERT = 'c0a1e2d3-4b5f-4c6d-8e7f-9a0b1c2d3e4f';
const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab', 'CalendarTab', 'CommunityTab'];
const COACH_TABS = ['CommandCenter', 'ProgramsStack', 'MoneyStack', 'CalendarStack', 'Messages', 'ClientsStack', 'SettingsStack', 'CommunityStack'];
const TITLE = 'Stand-in title';
const BODY = 'Stand-in body';

type Data = Record<string, unknown>;
type Row = [name: string, role: PushRole, data: Data];
const SAFETY: Data = { actionScreen: 'CoachSafetyAlert', deepLink: `tgp://coach/clients/${CLIENT}`, actionParams: { alertId: ALERT }, kind: 'coach_alert' };
const MESSAGE_CLIENT: Data = { actionScreen: 'Messages', deepLink: `tgp://messages/${CLIENT}`, kind: 'message_received' };
const MESSAGE_COACH: Data = { actionScreen: 'Messages', actionParams: { clientId: CLIENT }, deepLink: `tgp://messages/${CLIENT}`, kind: 'message_received' };
const BOOKING_CLIENT: Data = { actionScreen: 'CalendarSession', actionParams: { sessionId: SESSION }, deepLink: `tgp://client/sessions/${SESSION}`, sessionId: SESSION, kind: 'booking_confirmed' };
const PURCHASE_COACH: Data = { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/purchases/${PURCHASE}`, kind: 'coach_new_purchase' };
/** The kind table's senders, one row per data shape and role (PR body "Class-first path list"). */
const ROWS: Row[] = [
  // message-received.emitter.ts:51 (a coach's push names its client, pushTapData :1150-1151).
  ['message, client', 'student', MESSAGE_CLIENT],
  ['message, coach (lands on the inbox)', 'coach', MESSAGE_COACH],
  // booking.emitter.ts:603 (BOOKING_PUSH_SCREEN, pushTapData :1143-1149).
  ['booking, client', 'student', BOOKING_CLIENT],
  ['booking, coach', 'coach', { actionScreen: 'CoachBookingInbox', actionParams: { sessionId: SESSION }, deepLink: `tgp://coach/sessions/${SESSION}`, sessionId: SESSION, kind: 'booking_requested' }],
  // coach-alert.emitter.ts:127 with a safety context: safetyAlertTap (lock-screen-copy.ts:156-164).
  ['safety alert', 'coach', SAFETY],
  // community-safety.service.ts:356: the staff alert, no alertId and no link.
  ['staff community alert', 'coach', { actionScreen: 'NotificationCenter', kind: 'coach_alert' }],
  // purchase-fanout.service.ts:787.
  ['new purchase', 'coach', PURCHASE_COACH],
  // dunning-v2.dispatcher.ts:229-237 (the sender's own data, no link).
  ['dunning_payment', 'student', { kind: 'dunning_payment', actionScreen: 'UpdateCard' }],
  ['dunning_dispute', 'student', { kind: 'dunning_dispute', actionScreen: 'NotificationCenter' }],
  // nudge-engine.service.ts:418-426 (copy.ts:50-55: tgp://onboarding).
  ['nudge, onboarding', 'student', { kind: 'nudge_onboarding_abandoned', trigger_type: 'onboarding_abandoned', signal_key: 'k-1', deep_link: 'tgp://onboarding' }],
  ['nudge, missed check-in', 'student', { kind: 'nudge_missed_checkin', trigger_type: 'missed_checkin', signal_key: 'k-2', deep_link: 'tgp://checkin/today' }],
  // community-notifications.service.ts:265-275, the post reply's link community-posts.service.ts:474 (b#1247).
  ['community post reply, client', 'student', { kind: 'community_post_replied', category: 'community', target_type: 'post', target_id: POST, deepLink: `tgp://community/thread/${POST}` }],
  ['community post reply, coach', 'coach', { kind: 'community_post_replied', category: 'community', target_type: 'post', target_id: POST, deepLink: `tgp://community/thread/${POST}` }],
  // The same sender's DM push (community-dms.service.ts link): with m#962's coach DM rule merged, the coach row's
  // device tap opens the thread, and this table goes red until pushTapLanding follows it.
  ['community DM, client', 'student', { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: OTHER_CLIENT, deepLink: `tgp://community/dm/${OTHER_CLIENT}` }],
  ['community DM, coach', 'coach', { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: OTHER_CLIENT, deepLink: `tgp://community/dm/${OTHER_CLIENT}` }],
  // community-space-push.service.ts:136-147 (its own actionScreen and link).
  ['space push', 'student', { actionScreen: 'NotificationCenter', deepLink: `tgp://community/cohorts/${COHORT}?message=${MESSAGE}`, kind: 'community_message_received' }],
  // drip-dispatcher.cron.ts:558-564 (b#1247: Deliverables with the purchase, pushTapData :1139).
  ['drip released', 'student', { actionScreen: 'Deliverables', actionParams: { purchaseId: PURCHASE }, deepLink: 'tgp://client/library', kind: 'drip_released' }],
  // workout-builder.service.ts:1954.
  ['workout_assigned', 'student', { actionScreen: 'WorkoutMain', deepLink: `tgp://workouts/${ASSIGNMENT}`, kind: 'workout_assigned' }],
  // milestone-reached.emitter.ts:45, checkin-submitted.emitter.ts:56, plan-renewal.service.ts:144.
  ['milestone', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://timeline', kind: 'milestone_reached' }],
  ['check-in submitted', 'coach', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/clients/${CLIENT}/checkins`, kind: 'checkin_submitted' }],
  ['plan_renewal', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://home', kind: 'plan_renewal' }],
  // coach-brief.scheduler.ts:492, payout-notice.service.ts:478, trial-notice.service.ts:721, coach-nudge-send.ts:114,
  // scout.service.ts:604, workout-reminder.service.ts:298.
  ['coach daily brief', 'coach', { deep_link: 'tgp://coach/brief/today', brief_date: '2026-11-12', actionScreen: 'CoachBrief' }],
  ['payout notice', 'coach', { type: 'payout_adjustment', notice_id: 'n-1', deep_link: 'tgp://coach/money' }],
  ['trial_ending', 'student', { kind: 'trial_ending', purchase_id: PURCHASE, deep_link: 'tgp://plan', actionScreen: 'ClientPackages' }],
  ['coach_nudge', 'student', { type: 'coach_nudge', kind: 'coach_nudge', actionScreen: 'NotificationCenter', nudge_id: 'nudge-1', notification_id: 'row-1' }],
  ['import.complete', 'coach', { kind: 'import.complete', intent_id: 'intent-1', terminal_status: 'completed' }],
  ['workout reminder', 'student', { kind: 'workout_reminder', deep_link: `tgp://workouts/${ASSIGNMENT}`, local_date: '2026-11-12', first_day: false, assignment_id: ASSIGNMENT }],
  // reconciliation-daily.cron.ts:271-278 and the phone's own alerts (utils/notifications.ts:117-123,
  // ActiveWorkoutScreen.tsx:492-497): no destination.
  ['money check', 'coach', { type: 'money_check', verdict: 'ok' }],
  ['fasting alert', 'student', { type: 'fasting_complete' }],
  ['rest over', 'student', { type: 'rest_over' }],
];
const row = (name: string) => ROWS.find((r) => r[0] === name) as Row;

type Route = { name: string; params?: Record<string, unknown> };
const navigate = jest.fn();
const dispatch = jest.fn();
let receive: (n: unknown) => void;
let deviceTap: (r: unknown) => void;
let seq = 0;
let ready = true;
let focused: Route | undefined;
let rootNames: readonly string[] = CLIENT_TABS;
const container = {
  isReady: () => ready,
  getCurrentRoute: () => focused,
  getRootState: () => ({ routeNames: rootNames }),
};

function signIn(role: PushRole) {
  __resetPushTapRouterForTests();
  rootNames = role === 'coach' ? COACH_TABS : CLIENT_TABS;
  attachPushNavigator({ isReady: () => true, navigate, dispatch, getRootState: () => ({ routeNames: rootNames, routes: [] }) } as never);
  setPushSession({ kind: 'app', userId: role === 'coach' ? COACH : CLIENT, role });
}
const notification = (id: string, data: Data, title = TITLE, body = BODY) => ({ request: { identifier: id, content: { title, body, data } } });
/** The route a navigator call opens (deliverTarget, openTarget). */
function routeOf(call: unknown[]): Route {
  const [root, arg] = call as [string, Record<string, unknown> | undefined];
  if (arg && 'state' in arg) {
    const routes = (arg.state as { routes: Route[] }).routes;
    return routes[routes.length - 1];
  }
  if (arg && typeof arg.screen === 'string') return { name: arg.screen, params: arg.params as Record<string, unknown> | undefined };
  return { name: root, params: arg };
}
/** Where the device tap of this push lands, through the real router (dispatchResponse -> routePushTap). */
function deviceLanding(role: PushRole, data: Data): Route | null {
  signIn(role);
  navigate.mockClear();
  seq += 1;
  deviceTap({ notification: notification(`device-${seq}`, data) });
  return navigate.mock.calls.length > 0 ? routeOf(navigate.mock.calls[0]) : null;
}
async function push(data: Data, title = TITLE, body = BODY) {
  seq += 1;
  await act(async () => receive(notification(`push-${seq}`, data, title, body)));
  return `push-${seq}`;
}
const instantTiming = () => jest.spyOn(Animated, 'timing').mockReturnValue({
  start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
} as never);
const inContainer = () => render(
  <NavigationContainerRefContext.Provider value={container as never}>
    <ForegroundNotificationBanner />
  </NavigationContainerRefContext.Provider>,
);
const GLYPHS = (Ionicons as unknown as { glyphMap: Record<string, number> }).glyphMap;
const markText = (view: Awaited<ReturnType<typeof inContainer>>) => {
  const n = view.getByTestId('foreground-banner-mark', { includeHiddenElements: true });
  return [n.props.children].flat(Infinity).filter((c): c is string => typeof c === 'string').join('');
};
const glyph = (name: string) => String.fromCodePoint(GLYPHS[name]);

let timing: jest.SpyInstance;
let view: Awaited<ReturnType<typeof inContainer>>;
let stopReceived: () => void;
let stopResponse: () => void;
beforeAll(() => {
  stopReceived = installForegroundHandler();
  receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
  stopResponse = installNotificationResponseHandler(routePushTap);
  deviceTap = mockAddResponse.mock.calls[mockAddResponse.mock.calls.length - 1][0] as (r: unknown) => void;
});
afterAll(() => {
  stopReceived();
  stopResponse();
});
beforeEach(async () => {
  ready = true;
  focused = undefined;
  timing = instantTiming();
  view = await inContainer();
});
afterEach(async () => {
  await view.unmount();
  timing.mockRestore();
  await act(async () => foregroundBannerStore.getState().reset());
  jest.mocked(routePushTap).mockClear();
});
const state = () => ({ banner: foregroundBannerStore.getState().banner, count: foregroundBannerStore.getState().count });

describe('B1: the landing B1 reads is the device tap\'s own (pushTapLanding against the real routePushTap)', () => {
  it.each(ROWS)('%s', (_name, role, data) => {
    const landed = deviceLanding(role, data);
    const tap = pushTapOf(data);
    const landing = pushTapLanding(rootNames, tap.actionScreen, tap.actionParams, tap.deepLink);
    if (landed === null) {
      expect(landing).toBeNull();
      return;
    }
    expect(landing?.name).toBe(landed.name);
    expect(landed.params ?? {}).toMatchObject(landing?.params ?? {});
  });

  it('no role from the mounted root (neither anchor, or both): no landing', () => {
    expect(pushTapLanding(['Foo'], 'Messages')).toBeNull();
    expect(pushTapLanding([...CLIENT_TABS, ...COACH_TABS], 'Messages')).toBeNull();
  });

  it('a coach push naming its client and name lands on that chat (deliver\'s COACH-ROW-CHAT rule)', () => {
    const data = { actionScreen: 'Messages', actionParams: { clientId: CLIENT, clientName: 'Jordan Reyes' }, kind: 'message_received' };
    const landed = deviceLanding('coach', data);
    expect(landed?.name).toBe('ClientMessages');
    expect(pushTapLanding(COACH_TABS, 'Messages', data.actionParams)).toEqual({ name: 'ClientMessages', params: { clientId: CLIENT } });
  });

  // MERGEUP-966: these are coachDmLink's link forms (m#962), not sender rows: the older pair link read either way
  // round, a pair naming neither (nothing guessed, both fall back), and the id link with a query.
  it.each([
    ['older pair link, coach first', `tgp://community/dms/w1:${COACH}:${OTHER_CLIENT}`],
    ['older pair link, coach second', `tgp://community/dms/w1:${OTHER_CLIENT}:${COACH}`],
    ['older pair link naming neither', `tgp://community/dms/w1:${CLIENT}:${OTHER_CLIENT}`],
    ['id link with a query', `tgp://community/dm/${OTHER_CLIENT}?from=push`],
  ])('community DM, coach, %s', (_name, deepLink) => {
    const data = { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: OTHER_CLIENT, deepLink };
    const landed = deviceLanding('coach', data);
    const tap = pushTapOf(data);
    const landing = pushTapLanding(rootNames, tap.actionScreen, tap.actionParams, tap.deepLink);
    if (landed === null) {
      expect(landing).toBeNull();
      return;
    }
    expect(landing?.name).toBe(landed.name);
    expect(landed.params ?? {}).toMatchObject(landing?.params ?? {});
  });
});

describe('B1: no banner for the screen already open', () => {
  it.each(ROWS)('%s', async (_name, role, data) => {
    const landed = deviceLanding(role, data);
    signIn(role);
    if (landed === null) {
      // No destination (the money check, the phone's own alerts): the banner always shows, even on the Fasting screen.
      focused = { name: 'Fasting' };
      await push(data);
      expect(state().banner).not.toBeNull();
      return;
    }
    focused = landed;
    await push(data);
    expect(state()).toEqual({ banner: null, count: 0 });
    expect(view.queryByText(TITLE)).toBeNull();

    const keys = Object.keys(landed.params ?? {}).filter((k) => typeof landed.params?.[k] === 'string');
    if (keys.length > 0) {
      focused = { name: landed.name, params: { ...landed.params, [keys[0]]: 'another-item' } };
      await push(data);
      expect(view.getByText(TITLE)).toBeTruthy();
      await act(async () => foregroundBannerStore.getState().reset());
    }

    focused = landed;
    ready = false;
    await push(data);
    expect(view.getByText(TITLE)).toBeTruthy();
  });

  it('no container (the unit harnesses): every push shows', async () => {
    await view.unmount();
    view = await render(<ForegroundNotificationBanner />);
    signIn('student');
    focused = { name: 'Messages' };
    await push(MESSAGE_CLIENT);
    expect(view.getByText(TITLE)).toBeTruthy();
  });

  it('no role on the mounted root: the banner shows', async () => {
    signIn('student');
    rootNames = ['SomethingElse'];
    focused = { name: 'Messages' };
    await push(MESSAGE_CLIENT);
    expect(view.getByText(TITLE)).toBeTruthy();
  });

  it('the chat row (operator 22:4x): a coach in that client\'s chat gets no banner for the client\'s message', async () => {
    signIn('coach');
    focused = { name: 'ClientMessages', params: { clientId: CLIENT, clientName: 'Jordan Reyes' } };
    await push(MESSAGE_COACH);
    expect(state()).toEqual({ banner: null, count: 0 });
    // Another client's chat, or another kind for the same client: a card.
    focused = { name: 'ClientMessages', params: { clientId: OTHER_CLIENT, clientName: 'Riley' } };
    await push(MESSAGE_COACH);
    expect(view.getByText(TITLE)).toBeTruthy();
    await act(async () => foregroundBannerStore.getState().reset());
    focused = { name: 'ClientMessages', params: { clientId: CLIENT, clientName: 'Jordan Reyes' } };
    await push(row('check-in submitted')[2]);
    expect(view.getByText(TITLE)).toBeTruthy();
  });

  it('the Messages inbox opened from its tab (no clientId) still shows a coach\'s message push (its tap passes one)', async () => {
    signIn('coach');
    focused = { name: 'MessagesInbox' };
    await push(MESSAGE_COACH);
    expect(view.getByText(TITLE)).toBeTruthy();
  });
});

describe('B2: a safety card stays until closed', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('still up after 10 s; its close dismisses it', async () => {
    signIn('coach');
    await push(SAFETY);
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(view.getByText(TITLE)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Dismiss notification'));
    expect(view.queryByText(TITLE)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('its tap opens it, once', async () => {
    signIn('coach');
    navigate.mockClear();
    const id = await push(SAFETY);
    await fireEvent.press(view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`));
    expect(routePushTap).toHaveBeenCalledTimes(1);
    expect(routePushTap).toHaveBeenCalledWith('CoachSafetyAlert', { alertId: ALERT }, id, `tgp://coach/clients/${CLIENT}`);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state().banner).toBeNull();
  });

  it('a swipe does not take it (operator 22:4x); an ordinary card still swipes', async () => {
    const created = jest.spyOn(PanResponder, 'create');
    await view.unmount();
    signIn('coach');
    await push(SAFETY);
    view = await inContainer();
    const pan = created.mock.calls[created.mock.calls.length - 1][0];
    expect(pan.onMoveShouldSetPanResponder?.({} as never, { dy: -40 } as never)).toBe(false);
    await act(async () => foregroundBannerStore.getState().reset());
    await push(PURCHASE_COACH);
    const plain = created.mock.calls[created.mock.calls.length - 1][0];
    expect(plain.onMoveShouldSetPanResponder?.({} as never, { dy: -40 } as never)).toBe(true);
    created.mockRestore();
  });

  it('an ordinary push over it changes nothing; a later safety push replaces it with no count; the first one\'s record stays', async () => {
    signIn('coach');
    const first = await push(SAFETY, 'First alert');
    await push(PURCHASE_COACH, 'A purchase');
    expect(state().banner?.notificationId).toBe(first);
    expect(state().count).toBe(1);
    expect(view.getByText('First alert')).toBeTruthy();
    expect(view.queryByText('A purchase')).toBeNull();
    await push({ ...SAFETY, actionParams: { alertId: 'c0a1e2d3-0000-4c6d-8e7f-9a0b1c2d3e40' } }, 'Second alert');
    expect(view.getByText('Second alert')).toBeTruthy();
    expect(view.queryByText('First alert')).toBeNull();
    expect(state().count).toBe(1);
    expect(view.queryByText(/new$/)).toBeNull();
    expect(view.queryByTestId('foreground-banner-stack')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(view.getByText('Second alert')).toBeTruthy();
    // The Notifications list is the server's rows, written before each push (coach-alert.emitter.ts:99-111): the
    // replace reads, marks or clears none of them, and dismisses nothing from the phone's own list.
    expect(notificationsApi.markNotificationRead).not.toHaveBeenCalled();
    expect(notificationsApi.markAllNotificationsRead).not.toHaveBeenCalled();
    expect(notificationsApi.fetchNotifications).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('a safety push over an ordinary card replaces it, without a count', async () => {
    signIn('coach');
    await push(PURCHASE_COACH, 'A purchase');
    await push(SAFETY, 'An alert');
    expect(view.getByText('An alert')).toBeTruthy();
    expect(state().count).toBe(1);
    expect(view.queryByText(/new$/)).toBeNull();
  });
});

describe('B3: two arriving together show as one card with a count', () => {
  it('the newest words, mark and tap, "2 new", the stacked edge and the spoken count; then "3 new"', async () => {
    signIn('student');
    await push(MESSAGE_CLIENT, 'First title', 'First body');
    expect(view.queryByText(/new$/)).toBeNull();
    const id = await push(BOOKING_CLIENT, 'Second title', 'Second body');
    expect(view.getByText('2 new')).toBeTruthy();
    expect(view.getByText('Second title')).toBeTruthy();
    expect(view.queryByText('First title')).toBeNull();
    expect(markText(view)).toBe(glyph('calendar-outline'));
    expect(view.getByTestId('foreground-banner-stack')).toBeTruthy();
    expect(view.getByLabelText('2 new. Second title. Second body. Tap to view.')).toBeTruthy();
    await push(MESSAGE_CLIENT, 'Third title', 'Third body');
    expect(view.getByText('3 new')).toBeTruthy();
    expect(markText(view)).toBe(glyph('chatbubble-outline'));
    const newest = await push(BOOKING_CLIENT, 'Second title', 'Second body');
    await fireEvent.press(view.getByLabelText('4 new. Second title. Second body. Tap to view.'));
    expect(routePushTap).toHaveBeenCalledTimes(1);
    expect(jest.mocked(routePushTap).mock.calls[0]).toEqual(['CalendarSession', { sessionId: SESSION }, newest, `tgp://client/sessions/${SESSION}`]);
    expect(newest).not.toBe(id);
  });

  it('after a close the next push has no count; the reset clears it', async () => {
    signIn('student');
    await push(MESSAGE_CLIENT);
    await push(MESSAGE_CLIENT);
    expect(state().count).toBe(2);
    await fireEvent.press(view.getByLabelText('Dismiss notification'));
    expect(state()).toEqual({ banner: null, count: 0 });
    await push(MESSAGE_CLIENT);
    expect(state().count).toBe(1);
    expect(view.queryByText(/new$/)).toBeNull();
    expect(view.queryByTestId('foreground-banner-stack')).toBeNull();
    expect(view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`)).toBeTruthy();
    await push(MESSAGE_CLIENT);
    await act(async () => foregroundBannerStore.getState().reset());
    expect(state()).toEqual({ banner: null, count: 0 });
  });

  it('a push hidden by B1 does not count and leaves the card as it is', async () => {
    signIn('student');
    const first = await push(BOOKING_CLIENT, 'A booking');
    focused = deviceLanding('student', MESSAGE_CLIENT) as Route;
    signIn('student');
    await push(MESSAGE_CLIENT, 'A message');
    expect(state().count).toBe(1);
    expect(state().banner?.notificationId).toBe(first);
    expect(view.getByText('A booking')).toBeTruthy();
  });
});
