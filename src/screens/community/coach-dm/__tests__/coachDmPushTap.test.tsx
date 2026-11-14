/**
 * LS-962R1 C3 = LO-962R1 C2 (REFINE-962): a coach's tap on a community DM device push goes through the app's own push
 * handler (pushNotifications.ts dispatchResponse, installed once at the app root) and opens that one client's thread,
 * once. The push data is the server's (community-notifications.service.ts:272 at backend e24409bc: kind
 * community_dm_received, deepLink tgp://community/dm/<sender>, no actionScreen). Only expo-notifications and the
 * switches are stubbed; dispatchResponse, the push router and the link resolver are the real ones. Model:
 * src/services/__tests__/coachRowChatPush.test.tsx. pushNotifications.ts is not edited (m#966's file).
 */
const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockGetLast = jest.fn(() => Promise.resolve(null as unknown));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
// Every switch on ([R27]); one case turns communityDm off.
const mockFlags: Record<string, unknown> = {};
jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  for (const [k, v] of Object.entries(actual.featureFlags)) mockFlags[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: mockFlags };
});

const { installNotificationResponseHandler } = require('../../../../services/pushNotifications');
const router = require('../../../../services/pushTapRouter');

const COACH = '20000000-0000-4000-8000-000000000000';
const CLIENT = '30000000-0000-4000-8000-000000000000';
const COACH_TABS = ['CommandCenter', 'Templates', 'MoneyStack', 'CalendarStack', 'Messages', 'ClientsStack', 'CommunityStack', 'SettingsStack'];
const CLIENT_TABS = ['Home', 'WorkoutTab', 'CommunityTab', 'MoreTab'];
const THREAD = ['CommunityStack', { screen: 'CommunityDmThread', params: { recipientId: CLIENT }, initial: false }];

/** The device push for a community DM (community-notifications.service.ts:262-272; push-delivery adds kind). */
const response = (id: string, to: string = CLIENT) => ({
  notification: { request: { identifier: id, content: {
    title: 'Direct message', body: 'You have a new direct message.',
    data: { kind: 'community_dm_received', deepLink: `tgp://community/dm/${to}` },
  } } },
});

const navigate = jest.fn();
function signIn(role: 'coach' | 'student', userId: string) {
  router.attachPushNavigator({ isReady: () => true, navigate, getRootState: () => ({ routeNames: role === 'coach' ? COACH_TABS : CLIENT_TABS }) });
  router.setPushSession({ kind: 'app', userId, role });
}

beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  router.__resetPushTapRouterForTests();
  navigate.mockReset();
  mockAddResponse.mockClear();
});

describe('LS-962R1 C3: the coach\'s community DM push tap, through dispatchResponse', () => {
  it('opens that client\'s thread once; the same push tapped again does not open it twice', () => {
    signIn('coach', COACH);
    const stop = installNotificationResponseHandler(router.routePushTap);
    const listener = mockAddResponse.mock.calls[0][0] as (r: unknown) => void;
    listener(response('push-dm-1'));
    listener(response('push-dm-1'));
    expect(navigate.mock.calls).toEqual([THREAD]);
    stop();
  });

  it('a cold-start tap held until the coach\'s tabs are known opens the thread', async () => {
    router.setPushSession({ kind: 'unknown' });
    mockGetLast.mockReturnValueOnce(Promise.resolve(response('cold-dm-1')));
    const stop = installNotificationResponseHandler(router.routePushTap);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    signIn('coach', COACH);
    expect(navigate.mock.calls).toEqual([THREAD]);
    stop();
  });

  it('with communityDm off it keeps today\'s landing (the coach\'s Notifications list)', () => {
    mockFlags.communityDm = false;
    signIn('coach', COACH);
    const stop = installNotificationResponseHandler(router.routePushTap);
    (mockAddResponse.mock.calls[0][0] as (r: unknown) => void)(response('push-dm-2'));
    expect(navigate.mock.calls).toEqual([['ClientsStack', { screen: 'NotificationCenter', params: undefined }]]);
    stop();
  });

  it('a client\'s DM push opens the coach\'s thread in the Community tab, once (COACH-DM-CLIENT-M case 1)', () => {
    signIn('student', CLIENT);
    const stop = installNotificationResponseHandler(router.routePushTap);
    (mockAddResponse.mock.calls[0][0] as (r: unknown) => void)(response('push-dm-3', COACH));
    (mockAddResponse.mock.calls[0][0] as (r: unknown) => void)(response('push-dm-3', COACH));
    expect(navigate.mock.calls).toEqual([['CommunityTab', { screen: 'CommunityDmThread', params: { recipientId: COACH }, initial: false }]]);
    stop();
  });
});
