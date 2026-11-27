/**
 * PUSH-REPEAT-TAP-M (LS-945R6 F2, AUDIT 7208926572 on m#945): a tap is deduped per delivery, not per notification id.
 *
 * The class: the push kinds whose taps reach the app under one id. On backend main 31b489c5 only the unread push of a
 * space sets a collapse id and a tag (space-push-policy.ts:75, :100-103, sent at push-delivery.service.ts:724); the
 * space's reply and High alert pushes and every other kind set neither, so each of their deliveries has its own id.
 * The device makes the tag (Android, expo-notifications 56.0.18 FirebaseMessagingDelegate.kt:128-129) or the
 * apns-collapse-id (iOS) the request identifier. The phone's readers of the tapped-id guard: routePushTap
 * (pushTapRouter.ts:313-315) and routeAppLink (:333-335), fed by the device tap and the cold-start replay
 * (pushNotifications.ts dispatchResponse) and by the in-app banner (the id it is shown with, pushNotifications.ts
 * installForegroundHandler; ForegroundNotificationBanner.tsx:218-219).
 *
 * One table: each kind of the class (the unread push of a space for a client member and for the coach, plus a
 * link-only push under one id, the second guard reader's shape) through each way a tap arrives. The same delivery
 * handed over twice opens once (the listener twice; the listener beside getLastNotificationResponseAsync on a cold
 * start); a new delivery under the same id opens again. Dates as each platform hands them: Android the message's
 * sent time in ms (FirebaseMessagingDelegate.kt:120), iOS seconds since 1970 with a fraction (NotificationRecords.swift:441).
 * Only expo-notifications and the switches are doubled; pushNotifications, the push router and the link resolver are
 * the real ones. Not checked on a device.
 */
const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
let mockLast: unknown = null;
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => Promise.resolve(mockLast),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
// Every switch on ([R27]).
const mockFlags: Record<string, unknown> = {};
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  for (const [k, v] of Object.entries(actual.featureFlags)) mockFlags[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: mockFlags };
});

const { installForegroundHandler, installNotificationResponseHandler } = require('../pushNotifications');
const router = require('../pushTapRouter');
const { foregroundBannerStore } = require('../../store/foregroundBannerStore');
const { resolveAppLink } = require('../../navigation/incomingLinks');

const SPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = '30000000-0000-4000-8000-000000000000';
const COACH = 'b1c2d3e4-0000-4000-8000-00000000c0a1';
const CLIENT_TABS = ['Home', 'WorkoutTab', 'CommunityTab', 'MoreTab'];
const COACH_TABS = ['CommandCenter', 'ProgramsStack', 'MoneyStack', 'CalendarStack', 'Messages', 'ClientsStack', 'CommunityStack'];

interface Kind {
  name: string;
  role: 'student' | 'coach';
  userId: string;
  tabs: string[];
  identifier: string;
  data: Record<string, unknown>;
  /** The navigate call one tap makes on main's routes. */
  opens: () => unknown[];
}

/** The space link as this build resolves it: that space's chat once a resolver knows the route (m#945), else the
 *  kind's own screen (main: the Community tab for a client; a coach's Community push lands on Notifications). */
const spaceOpens = (role: 'student' | 'coach', fallback: unknown[]) => () => {
  const chat = resolveAppLink(`community/cohorts/${SPACE}`, role) as { root: string; screen: string } | null;
  return chat ? [chat.root, expect.objectContaining({ screen: chat.screen, params: { cohortId: SPACE } })] : fallback;
};

const KINDS: Kind[] = [
  {
    name: 'unread messages of a space, a client member (server collapse id and tag)',
    role: 'student', userId: MEMBER, tabs: CLIENT_TABS, identifier: `space-unread-${SPACE}`,
    data: { kind: 'community_message_received', deepLink: `tgp://community/cohorts/${SPACE}` },
    opens: spaceOpens('student', ['CommunityTab', undefined]),
  },
  {
    name: 'unread messages of a space, the coach member (the same push)',
    role: 'coach', userId: COACH, tabs: COACH_TABS, identifier: `space-unread-${SPACE}`,
    data: { kind: 'community_message_received', deepLink: `tgp://community/cohorts/${SPACE}` },
    opens: spaceOpens('coach', ['ClientsStack', { screen: 'NotificationCenter' }]),
  },
  {
    // No server kind shares an id on this path today; covered so a later collapse id cannot bring the bug back.
    name: 'a link-only push under one id (the second guard reader, routeAppLink)',
    role: 'student', userId: MEMBER, tabs: CLIENT_TABS, identifier: 'one-tag-for-every-nudge',
    data: { kind: 'checkin_nudge', deepLink: 'tgp://checkin/today' },
    opens: () => ['Home', { screen: 'Habits', initial: false }],
  },
];

const ANDROID_1 = Date.UTC(2026, 10, 27, 9, 0);
const ANDROID_2 = Date.UTC(2026, 10, 27, 14, 0);
const IOS_1 = ANDROID_1 / 1000 + 0.25;
const IOS_2 = ANDROID_2 / 1000 + 0.5;

/** One delivery as expo-notifications hands it over (Notification: date + request). */
const delivery = (k: Kind, date: number | undefined, n = 1) => ({
  ...(date === undefined ? {} : { date }),
  request: { identifier: k.identifier, content: { title: 'Announcements', body: `${n} unread messages in Announcements`, data: k.data } },
});
const response = (k: Kind, date: number | undefined, n = 1) => ({
  notification: delivery(k, date, n),
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
});

const navigate = jest.fn();
const stops: (() => void)[] = [];
const flush = () => new Promise((r) => setImmediate(r));
const attach = (k: Kind) => {
  router.attachPushNavigator({ isReady: () => true, navigate, getRootState: () => ({ routeNames: k.tabs, routes: [] }) });
  router.setPushSession({ kind: 'app', userId: k.userId, role: k.role });
};
/** Installs the device-tap handler (with what getLastNotificationResponseAsync answers) and returns its listener. */
const installTaps = async (last: unknown = null) => {
  mockLast = last;
  mockAddResponse.mockClear();
  stops.push(installNotificationResponseHandler(router.routePushTap));
  await flush();
  return mockAddResponse.mock.calls[0][0] as (r: unknown) => void;
};
/** Installs the foreground handler and returns: receive a push in the foreground, then tap the banner it shows
 *  (ForegroundNotificationBanner.tsx:218-219 routes the banner's own fields). */
const installBanner = () => {
  mockAddReceived.mockClear();
  stops.push(installForegroundHandler());
  const receive = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
  return {
    receive,
    tapBanner: () => {
      const b = foregroundBannerStore.getState().banner;
      router.routePushTap(b.actionScreen, b.actionParams, b.notificationId, b.deepLink);
    },
  };
};

interface Case {
  name: string;
  /** How many times the tap opens its screen. */
  opens: number;
  run: (k: Kind) => Promise<void>;
}

const CASES: Case[] = [
  {
    name: 'the same response twice (the listener fires twice) opens once',
    opens: 1,
    run: async (k) => {
      attach(k);
      const tap = await installTaps();
      const r = response(k, ANDROID_1);
      tap(r);
      tap(r);
    },
  },
  {
    name: 'two deliveries of one id open twice (Android dates)',
    opens: 2,
    run: async (k) => {
      attach(k);
      const tap = await installTaps();
      tap(response(k, ANDROID_1, 1));
      tap(response(k, ANDROID_2, 2));
    },
  },
  {
    name: 'two deliveries of one id open twice (iOS dates)',
    opens: 2,
    run: async (k) => {
      attach(k);
      const tap = await installTaps();
      tap(response(k, IOS_1, 1));
      tap(response(k, IOS_2, 2));
    },
  },
  {
    name: 'a cold-start replay, the listener first (then getLastNotificationResponseAsync, one response) opens once',
    opens: 1,
    run: async (k) => {
      attach(k);
      const launch = response(k, IOS_1);
      mockLast = launch;
      mockAddResponse.mockClear();
      stops.push(installNotificationResponseHandler(router.routePushTap));
      (mockAddResponse.mock.calls[0][0] as (r: unknown) => void)({ ...launch, notification: { ...launch.notification } });
      await flush();
    },
  },
  {
    name: 'a cold-start replay, getLastNotificationResponseAsync first (then the listener, one response) opens once',
    opens: 1,
    run: async (k) => {
      attach(k);
      const launch = response(k, ANDROID_1);
      const tap = await installTaps(launch);
      tap({ ...launch, notification: { ...launch.notification } });
    },
  },
  {
    name: 'a cold start before the app is ready: the launch tap and its replay open once, a later delivery again',
    opens: 2,
    run: async (k) => {
      const launch = response(k, ANDROID_1, 1);
      const tap = await installTaps(launch);
      tap(launch);
      attach(k);
      await flush();
      tap(response(k, ANDROID_2, 2));
    },
  },
  {
    name: 'in-app banner: two deliveries received in the foreground, each banner tapped, open twice',
    opens: 2,
    run: async (k) => {
      attach(k);
      const { receive, tapBanner } = installBanner();
      receive(delivery(k, IOS_1, 1));
      tapBanner();
      foregroundBannerStore.getState().dismissBanner();
      receive(delivery(k, IOS_2, 2));
      tapBanner();
    },
  },
  {
    name: 'in-app banner: one banner tapped twice opens once',
    opens: 1,
    run: async (k) => {
      attach(k);
      const { receive, tapBanner } = installBanner();
      receive(delivery(k, ANDROID_1));
      tapBanner();
      tapBanner();
    },
  },
  {
    name: 'a banner tap and a later device tap of a new delivery under the same id open twice',
    opens: 2,
    run: async (k) => {
      attach(k);
      const { receive, tapBanner } = installBanner();
      receive(delivery(k, ANDROID_1, 1));
      tapBanner();
      const tap = await installTaps();
      tap(response(k, ANDROID_2, 2));
    },
  },
  {
    // The library always sends a date (Notification.date: number); without one the deliveries cannot be told apart.
    name: 'a response without a date keeps the old rule: its id opens once',
    opens: 1,
    run: async (k) => {
      attach(k);
      const tap = await installTaps();
      tap(response(k, undefined, 1));
      tap(response(k, undefined, 2));
    },
  },
];

beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  router.__resetPushTapRouterForTests();
  foregroundBannerStore.getState().reset();
  navigate.mockReset();
  mockLast = null;
});
afterEach(() => {
  while (stops.length > 0) stops.pop()?.();
});

describe.each(KINDS.map((k) => [k.name, k] as const))('%s', (_name, kind) => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', async (_case, c) => {
    await c.run(kind);
    expect(navigate.mock.calls).toEqual(Array.from({ length: c.opens }, () => kind.opens()));
  });
});
