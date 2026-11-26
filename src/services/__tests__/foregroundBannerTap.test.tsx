/**
 * FOREGROUND-BANNER-M (cases 4, 5, 7, 8, 9, 10): a push that arrives while the app is open is the in-app banner, and
 * its tap lands exactly where a device tap of the same push lands, through the same mapping and routePushTap.
 * Real pushNotifications, foregroundBannerStore, ForegroundNotificationBanner and pushTapRouter; expo-notifications is
 * mocked at its edge (as coachRowChatPush.test.tsx:13-23). Every row's data is copied key for key from the backend
 * sender at growth-project-backend e24409bc1a955f6be60a6bc7ac1cd07af4d281fe (cited beside it): a template push's data
 * is pushTapData (notifications.service.ts:1117-1150) plus kind (push/push-delivery.service.ts:717); a sender's own
 * push carries the data it was sent with (notifications.service.ts:887-950). Every switch on ([R27]).
 * Titles and bodies are ordinary stand-ins: the banner shows exactly what it is given.
 */
import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockSetHandler = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: (h: unknown) => mockSetHandler(h),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
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
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { textPrimary: '#1A1A18', textOnPrimary: '#FFFDF8', primary: '#4A0404', primaryPale: '#EFE6DC' } }),
}));
// The banner's own navigate at base; the router never uses it.
const mockScreenNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockScreenNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));
// The router, real, with its entry recorded so the arguments each path hands it can be compared (case 7).
jest.mock('../pushTapRouter', () => {
  const actual = jest.requireActual('../pushTapRouter');
  return { ...actual, routePushTap: jest.fn((...a: unknown[]) => actual.routePushTap(...a)) };
});

import ForegroundNotificationBanner from '../../components/ForegroundNotificationBanner';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';
import { installForegroundHandler, installNotificationResponseHandler } from '../pushNotifications';
import {
  __resetPushTapRouterForTests, attachPushNavigator, decodePushParams, routePushTap, setPushSession,
  type PushRole,
} from '../pushTapRouter';

const CLIENT = '0b9a2a52-6f0e-4c39-9d43-2f1f3c1f6a01';
const COACH = 'b1c2d3e4-0000-4000-8000-00000000c0a1';
const SESSION = '5d1c7a40-2b0e-4f6e-9a51-6c1f0e2a7b11';
const ASSIGNMENT = '7f3e9d20-1c4b-4a8e-b2f6-0d9c8e7a6b51';
const COHORT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MESSAGE = '3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a99';
const SENDER = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const PURCHASE = '6e5d4c3b-2a19-4f8e-9d7c-6b5a4e3d2c1b';
const ALERT = 'c0a1e2d3-4b5f-4c6d-8e7f-9a0b1c2d3e4f';
const CLIENT_TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab', 'CalendarTab', 'CommunityTab'];
const COACH_TABS = ['CommandCenter', 'ProgramsStack', 'MoneyStack', 'CalendarStack', 'Messages', 'ClientsStack', 'SettingsStack', 'CommunityStack'];
const TITLE = 'Stand-in title';
const BODY = 'Stand-in body';

type Row = [name: string, role: PushRole, data: Record<string, unknown>];
/** The class table, one row per data shape and role (PR body "Class-first path list"). */
const ROWS: Row[] = [
  // message-received.emitter.ts:51 (deep link :38; a coach gets tap_client_id, notifications.service.ts:1144-1145).
  ['message, client', 'student', { actionScreen: 'Messages', deepLink: `tgp://messages/${CLIENT}`, kind: 'message_received' }],
  ['message, coach (inbox: no name)', 'coach', { actionScreen: 'Messages', actionParams: { clientId: CLIENT }, deepLink: `tgp://messages/${CLIENT}`, kind: 'message_received' }],
  // booking.emitter.ts:603 (links :272 and :218; BOOKING_PUSH_SCREEN notifications.service.ts:1105).
  ['booking, client', 'student', { actionScreen: 'CalendarSession', actionParams: { sessionId: SESSION }, deepLink: `tgp://client/sessions/${SESSION}`, sessionId: SESSION, kind: 'booking_confirmed' }],
  ['booking, coach', 'coach', { actionScreen: 'CoachBookingInbox', actionParams: { sessionId: SESSION }, deepLink: `tgp://coach/sessions/${SESSION}`, sessionId: SESSION, kind: 'booking_requested' }],
  // build-week-day-unlocked.emitter.ts:47.
  ['build week day', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://build-week/day/3', kind: 'build_week_day_unlocked' }],
  // checkin-submitted.emitter.ts:56.
  ['check-in submitted', 'coach', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/clients/${CLIENT}/checkins`, kind: 'checkin_submitted' }],
  // coach-alert.emitter.ts:127 with a safety context: safetyAlertTap (lock-screen-copy.ts:159-164), link :82-86.
  ['safety alert with alertId', 'coach', { actionScreen: 'CoachSafetyAlert', deepLink: `tgp://coach/clients/${CLIENT}`, actionParams: { alertId: ALERT }, kind: 'coach_alert' }],
  // community-safety.service.ts:356: the staff alert (#203-E21), no alertId and no link.
  ['staff community alert', 'coach', { actionScreen: 'NotificationCenter', kind: 'coach_alert' }],
  // first-payment.emitter.ts:118 (link :78).
  ['first payment', 'coach', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/clients/${CLIENT}`, kind: 'first_payment' }],
  // milestone-reached.emitter.ts:45.
  ['milestone', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://timeline', kind: 'milestone_reached' }],
  // missed-checkin.emitter.ts:50 (client) and :76 (coach).
  ['missed check-in, client', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://checkin/today', kind: 'missed_checkin' }],
  ['missed check-in, coach', 'coach', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/clients/${CLIENT}`, kind: 'missed_checkin' }],
  // weight-trend-alert.emitter.ts:59.
  ['weight trend', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://weight', kind: 'weight_trend_alert' }],
  // plan-renewal.service.ts:144.
  ['plan_renewal', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://home', kind: 'plan_renewal' }],
  // community-space-push.service.ts:136 (its own actionScreen from pushTapData).
  ['space push', 'student', { actionScreen: 'NotificationCenter', deepLink: `tgp://community/cohorts/${COHORT}?message=${MESSAGE}`, kind: 'community_message_received' }],
  // drip-dispatcher.cron.ts:558 and package-push.service.ts:749.
  ['drip released', 'student', { actionScreen: 'NotificationCenter', deepLink: 'tgp://client/library', kind: 'drip_released' }],
  // purchase-fanout.service.ts:787 (link :764).
  ['new purchase', 'coach', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/purchases/${PURCHASE}`, kind: 'coach_new_purchase' }],
  // program-library.service.ts:1476 and workout-builder.service.ts:1954 (link :1940).
  ['workout_assigned', 'student', { actionScreen: 'WorkoutMain', deepLink: `tgp://workouts/${ASSIGNMENT}`, kind: 'workout_assigned' }],
  // dunning-v2.dispatcher.ts:229-231 (sender's own: "Payment"; no link).
  ['dunning_payment', 'student', { kind: 'dunning_payment', actionScreen: 'UpdateCard' }],
  ['dunning_dispute', 'student', { kind: 'dunning_dispute', actionScreen: 'NotificationCenter' }],
  // payout-notice.service.ts:478-485 (PAYOUT_NOTICE_DEEP_LINK :34; deep_link spelled snake case, no kind).
  ['payout notice', 'coach', { type: 'payout_adjustment', notice_id: 'n-1', deep_link: 'tgp://coach/money' }],
  // reconciliation-daily.cron.ts:271-275 (MONEY_CHECK_ROW_TYPE current-coach-inbox.ts:31): no screen, no link.
  ['money check', 'coach', { type: 'money_check', verdict: 'ok' }],
  // coach-brief.scheduler.ts:492-500.
  ['coach daily brief', 'coach', { deep_link: 'tgp://coach/brief/today', brief_date: '2026-11-12', actionScreen: 'CoachBrief' }],
  // community-notifications.service.ts:263-273: kind only, a DM adds its link (community-dms.service.ts:236).
  ['community post reply, client', 'student', { kind: 'community_post_replied', category: 'community', target_type: 'post', target_id: MESSAGE }],
  ['community post reply, coach', 'coach', { kind: 'community_post_replied', category: 'community', target_type: 'post', target_id: MESSAGE }],
  ['community DM, client', 'student', { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: SENDER, deepLink: `tgp://community/dm/${SENDER}` }],
  ['community DM, coach', 'coach', { kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: SENDER, deepLink: `tgp://community/dm/${SENDER}` }],
  // workout-reminder.service.ts:298-302 (deep link :232, payload :233-237).
  ['workout reminder', 'student', { kind: 'workout_reminder', deep_link: `tgp://workouts/${ASSIGNMENT}`, local_date: '2026-11-12', first_day: false, assignment_id: ASSIGNMENT }],
  // nudge-engine.service.ts:418-427 (TRIGGER_TO_KIND :60-65, copy.ts:42).
  ['nudge', 'student', { kind: 'nudge_missed_checkin', trigger_type: 'missed_checkin', signal_key: 'k-1', deep_link: 'tgp://checkin/today' }],
  // coach-nudge-send.ts:114-125 (COACH_NUDGE_KIND :20, COACH_NUDGE_TAP_SCREEN :25).
  ['coach_nudge', 'student', { type: 'coach_nudge', kind: 'coach_nudge', actionScreen: 'NotificationCenter', nudge_id: 'nudge-1', notification_id: 'row-1' }],
  // trial-notice.service.ts:721-731 (TRIAL_ACTION_SCREEN :116).
  ['trial_ending', 'student', { kind: 'trial_ending', purchase_id: PURCHASE, deep_link: 'tgp://plan', actionScreen: 'ClientPackages' }],
  // scout.service.ts:604-609.
  ['import.complete', 'coach', { kind: 'import.complete', intent_id: 'intent-1', terminal_status: 'completed' }],
  // The phone's own local notifications: utils/notifications.ts:117-123 (fasting), ActiveWorkoutScreen.tsx:492-497 (rest over).
  ['fasting alert', 'student', { type: 'fasting_complete' }],
  ['rest over', 'student', { type: 'rest_over' }],
];

const navigate = jest.fn();
const dispatch = jest.fn();
const routerArgs = routePushTap as unknown as jest.Mock;
let receive: (n: unknown) => void;
let tap: (r: unknown) => void;
let seq = 0;

function signIn(role: PushRole) {
  __resetPushTapRouterForTests();
  attachPushNavigator({
    isReady: () => true, navigate, dispatch,
    getRootState: () => ({ routeNames: role === 'coach' ? COACH_TABS : CLIENT_TABS, routes: [] }),
  } as never);
  setPushSession({ kind: 'app', userId: role === 'coach' ? COACH : CLIENT, role });
}
const content = (data: Record<string, unknown>, title = TITLE, body = BODY) => ({ title, body, data });
const notification = (id: string, c: ReturnType<typeof content>) => ({ request: { identifier: id, content: c } });
/** routePushTap's arguments without trailing undefineds (the device path passes 3 without a link, 4 with one). */
const trim = (a: unknown[]) => { const out = [...a]; while (out.length > 0 && out[out.length - 1] === undefined) out.pop(); return out; };
const instantTiming = () => jest.spyOn(Animated, 'timing').mockReturnValue({
  start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
} as never);

/** The device tap of this content: dispatchResponse -> routePushTap. Returns the navigator calls and router arguments. */
function deviceTap(data: Record<string, unknown>) {
  navigate.mockClear();
  dispatch.mockClear();
  routerArgs.mockClear();
  seq += 1;
  tap({ notification: notification(`device-${seq}`, content(data)) });
  return { nav: [...navigate.mock.calls, ...dispatch.mock.calls], args: routerArgs.mock.calls.map((c) => trim(c).slice(0, 2).concat(trim(c).slice(3))) };
}

/** The same content received while open, drawn and tapped. */
async function bannerTap(data: Record<string, unknown>) {
  navigate.mockClear();
  dispatch.mockClear();
  routerArgs.mockClear();
  mockScreenNavigate.mockClear();
  seq += 1;
  await act(async () => receive(notification(`banner-${seq}`, content(data))));
  const held = foregroundBannerStore.getState().banner;
  const timing = instantTiming();
  const view = await render(<ForegroundNotificationBanner />);
  await fireEvent.press(view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`));
  timing.mockRestore();
  await view.unmount();
  return {
    held,
    nav: [...navigate.mock.calls, ...dispatch.mock.calls, ...mockScreenNavigate.mock.calls.map((c) => ['own navigate', ...c])],
    args: routerArgs.mock.calls.map((c) => trim(c).slice(0, 2).concat(trim(c).slice(3))),
  };
}

let stopReceived: () => void;
let stopResponse: () => void;
beforeAll(() => {
  stopReceived = installForegroundHandler();
  receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
  stopResponse = installNotificationResponseHandler(routePushTap);
  tap = mockAddResponse.mock.calls[mockAddResponse.mock.calls.length - 1][0] as (r: unknown) => void;
});
afterAll(() => {
  stopReceived();
  stopResponse();
});
afterEach(async () => {
  await act(async () => foregroundBannerStore.getState().reset());
});

describe('case 4: the banner tap is the device tap of the same push (navigator calls equal)', () => {
  it.each(ROWS)('%s', async (_name, role, data) => {
    signIn(role);
    const device = deviceTap(data);
    signIn(role);
    const banner = await bannerTap(data);
    expect(banner.nav).toEqual(device.nav);
  });

  it('the rows the brief names land where the device lands', async () => {
    const landing = (role: PushRole, data: Record<string, unknown>) => { signIn(role); return deviceTap(data).nav; };
    const reply = ROWS.find((r) => r[0] === 'community post reply, client')![2];
    expect(landing('student', reply)).toEqual([['CommunityTab', undefined]]);
    expect(landing('coach', reply)).toEqual([['ClientsStack', { screen: 'NotificationCenter', params: undefined }]]);
    // COACH-DM-CLIENT-M case 1: the client's DM push opens that person's thread, as the coach's does.
    expect(landing('student', ROWS.find((r) => r[0] === 'community DM, client')![2]))
      .toEqual([['CommunityTab', { screen: 'CommunityDmThread', params: { recipientId: SENDER }, initial: false }]]);
    expect(landing('coach', ROWS.find((r) => r[0] === 'message, coach (inbox: no name)')![2]))
      .toEqual([['Messages', { screen: 'MessagesInbox', params: { clientId: CLIENT }, pop: true }]]);
    expect(landing('student', ROWS.find((r) => r[0] === 'trial_ending')![2]))
      .toEqual([['Home', { screen: 'NotificationCenter', params: undefined }]]);
    for (const quiet of ['money check', 'fasting alert', 'rest over']) {
      const [, role, data] = ROWS.find((r) => r[0] === quiet)!;
      expect(landing(role, data)).toEqual([]);
    }
  });
});

describe('case 5: the banner holds the screen, params and link dispatchResponse hands the router (one mapping)', () => {
  it.each(ROWS)('%s', async (_name, role, data) => {
    signIn(role);
    deviceTap(data);
    const [screen, params, , link] = routerArgs.mock.calls[0] as unknown[];
    await act(async () => receive(notification('mapped-1', content(data))));
    const held = foregroundBannerStore.getState().banner;
    expect({ screen: held?.actionScreen, params: held?.actionParams, link: held?.deepLink }).toEqual({ screen, params, link });
  });
});

describe('case 7: untrusted data reaches the router exactly as decodePushParams leaves it', () => {
  const raw = {
    ok: 'a', count: 5, nested: { x: 1 }, 'bad-key': 'x', long: 'y'.repeat(201),
    k1: '1', k2: '2', k3: '3', k4: '4', k5: '5', k6: '6', k7: '7', k8: '8',
  };
  it.each([
    ['with a link', { actionScreen: 'Messages', actionParams: raw, deepLink: `tgp://messages/${CLIENT}`, kind: 'message_received' }],
    ['without a link', { actionScreen: 'UpdateCard', actionParams: raw, kind: 'dunning_payment' }],
  ])('params %s: the router gets the decoded map, as from the device', async (_n, data) => {
    signIn('student');
    const banner = await bannerTap(data);
    expect(banner.held?.actionParams).toEqual(decodePushParams(raw));
    expect(Object.keys(banner.held?.actionParams ?? {})).toHaveLength(8);
    expect(banner.args[0][1]).toEqual(decodePushParams(raw));
    signIn('student');
    expect(banner.nav).toEqual(deviceTap(data).nav);
  });

  it('a screen the role table does not list lands on that role\'s notification center', async () => {
    signIn('coach');
    const banner = await bannerTap({ actionScreen: 'NoSuchScreen', kind: 'coach_nudge' });
    expect(banner.nav).toEqual([['ClientsStack', { screen: 'NotificationCenter', params: undefined }]]);
  });

  it('an untrusted link host opens nothing on either path', async () => {
    const data = { actionScreen: 'NotificationCenter', deepLink: 'https://unknown.example/meal-plan/one', kind: 'message_received' };
    signIn('student');
    expect(deviceTap(data).nav).toEqual([]);
    signIn('student');
    expect((await bannerTap(data)).nav).toEqual([]);
  });
});

describe('case 8: one tap routes once', () => {
  it.each([
    ['no link', { kind: 'dunning_payment', actionScreen: 'UpdateCard' }],
    ['a link', { actionScreen: 'NotificationCenter', deepLink: 'tgp://timeline', kind: 'milestone_reached' }],
  ])('two quick taps on one banner (%s), then the same id from the device: one navigation', async (_n, data) => {
    signIn('student');
    navigate.mockClear();
    mockScreenNavigate.mockClear();
    await act(async () => receive(notification('once-1', content(data))));
    const ends: ((r: { finished: boolean }) => void)[] = [];
    const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
      start: (done?: (r: { finished: boolean }) => void) => { if (done) ends.push(done); }, stop: jest.fn(), reset: jest.fn(),
    } as never);
    const view = await render(<ForegroundNotificationBanner />);
    const target = view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`);
    await fireEvent.press(target);
    await fireEvent.press(target);
    await act(async () => { ends.splice(0).forEach((done) => done({ finished: true })); });
    tap({ notification: notification('once-1', content(data)) });
    expect(navigate.mock.calls.length + mockScreenNavigate.mock.calls.length).toBe(1);
    timing.mockRestore();
    await view.unmount();
  });
});

describe('case 9: replace, close and auto-dismiss', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a second notification replaces the first and restarts the 4 s; auto-dismiss and close route nothing', async () => {
    signIn('coach');
    navigate.mockClear();
    mockScreenNavigate.mockClear();
    const timing = instantTiming();
    const data = { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/clients/${CLIENT}`, kind: 'first_payment' };
    await act(async () => receive(notification('r-1', content(data, 'First stand-in', BODY))));
    const view = await render(<ForegroundNotificationBanner />);
    await act(async () => { jest.advanceTimersByTime(3000); });
    await act(async () => receive(notification('r-2', content(data, 'Second stand-in', BODY))));
    expect(view.queryByText('First stand-in')).toBeNull();
    expect(view.getByText('Second stand-in')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(view.getByText('Second stand-in')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1100); });
    expect(view.queryByText('Second stand-in')).toBeNull();
    await act(async () => receive(notification('r-3', content(data))));
    await fireEvent.press(view.getByLabelText('Dismiss notification'));
    expect(view.queryByText(TITLE)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(mockScreenNavigate).not.toHaveBeenCalled();
    timing.mockRestore();
    await view.unmount();
  });
});

describe('step 3d: a notification with no words draws nothing', () => {
  it('an empty title and an empty body write no banner', async () => {
    await act(async () => receive(notification('empty-1', content({ kind: 'message_received' }, '', ''))));
    expect(foregroundBannerStore.getState().banner).toBeNull();
    const view = await render(<ForegroundNotificationBanner />);
    expect(view.toJSON()).toBeNull();
  });

  it('a body alone still shows (the rest-over alert has no title)', async () => {
    await act(async () => receive(notification('rest-1', content({ type: 'rest_over' }, '', 'Rest over.'))));
    const view = await render(<ForegroundNotificationBanner />);
    expect(view.getByText('Rest over.')).toBeTruthy();
  });
});

describe('case 10: the phone\'s own banner stays off', () => {
  it('setNotificationHandler answers as at base', async () => {
    const handler = mockSetHandler.mock.calls[0][0] as { handleNotification: () => Promise<unknown> };
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: true,
    });
  });
});
