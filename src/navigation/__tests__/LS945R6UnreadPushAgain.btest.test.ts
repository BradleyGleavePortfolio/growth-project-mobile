/**
 * LS-945R6 follow-up F2 (growth-project-mobile#945 @ a0fe0331, found outside the fix commits, A1.9 step 3; not a B of
 * review round 6): every unread push of one space reaches the app under one notification id, and the app opens a
 * notification id only once.
 *   - The server sends every unread push of a space with one collapseId and one tag, "space-unread-<space>", so a
 *     later one replaces the earlier one on the lock screen (backend space-push-policy.ts:75, :100-103).
 *   - The device hands the app that value as the notification's request.identifier: on Android expo-notifications
 *     reads data.tag first (the installed 56.0.18, FirebaseMessagingDelegate.kt:128-129); on iOS a remote
 *     notification's identifier is its apns-collapse-id.
 *   - dispatchResponse passes the identifier on (pushNotifications.ts:203-213) and routePushTap drops a tap whose id
 *     it has routed before (pushTapRouter.ts:316-318; the ids are kept while the app lives, :209, :230-236).
 * So after her first tap on an unread push of a space, a later unread push of that space opens nothing until the app
 * is restarted. The guard is there for one tap delivered twice (the cold-start replay beside the live listener):
 * that must stay one open (the control below, and SPLIT938SpaceLinks 'the same push id opens once').
 * Not checked on a device. Only expo-notifications and the switches are doubled; dispatchResponse, the push router
 * and the link resolver are the real ones (model: coach-dm/__tests__/coachDmPushTap.test.tsx).
 */
const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
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

const { installNotificationResponseHandler } = require('../../services/pushNotifications');
const router = require('../../services/pushTapRouter');

const SPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = '30000000-0000-4000-8000-000000000000';
const CLIENT_TABS = ['Home', 'WorkoutTab', 'CommunityTab', 'MoreTab'];
/** One unread push of the space as the device hands it over: the same identifier every time (the server's collapse
 *  id and tag), its own delivery time and its own count. */
const unread = (count: number, date: number) => ({
  notification: { date, request: { identifier: `space-unread-${SPACE}`, content: {
    title: 'Announcements', body: count === 1 ? '1 unread message in Announcements' : `${count} unread messages in Announcements`,
    data: { kind: 'community_message_received', deepLink: `tgp://community/cohorts/${SPACE}` },
  } } },
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
});
const toTheSpace = ['CommunityTab', expect.objectContaining({ screen: 'CommunitySpaceChat', params: { cohortId: SPACE } })];

const navigate = jest.fn();
let tap: (r: unknown) => void;
let stop: () => void;
beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  router.__resetPushTapRouterForTests();
  navigate.mockReset();
  mockAddResponse.mockClear();
  router.attachPushNavigator({ isReady: () => true, navigate, getRootState: () => ({ routeNames: CLIENT_TABS }) });
  router.setPushSession({ kind: 'app', userId: MEMBER, role: 'student' });
  stop = installNotificationResponseHandler(router.routePushTap);
  tap = mockAddResponse.mock.calls[0][0] as (r: unknown) => void;
});
afterEach(() => stop());

it('LS945R6 F2: a later unread push of the same space, tapped after an earlier one was, opens the space again', () => {
  tap(unread(1, Date.UTC(2026, 10, 27, 9, 0)));
  expect(navigate.mock.calls).toEqual([toTheSpace]);
  // She leaves the space. Hours later the coach posts again; the new push carries the same identifier.
  tap(unread(2, Date.UTC(2026, 10, 27, 14, 0)));
  expect(navigate.mock.calls).toEqual([toTheSpace, toTheSpace]);
});

it('control: one tap delivered twice (the cold-start replay beside the live listener) opens the space once', () => {
  const once = unread(1, Date.UTC(2026, 10, 27, 9, 0));
  tap(once);
  tap(once);
  expect(navigate.mock.calls).toEqual([toTheSpace]);
});
