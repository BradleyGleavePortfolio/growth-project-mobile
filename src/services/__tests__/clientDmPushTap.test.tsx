/**
 * COACH-DM-CLIENT-M (cases 1 to 3, 5 to 8 and 14): a client's community DM device push, the same push as the in-app
 * banner, and a tap held through a cold start open that one person's thread once, for the signed-in account only,
 * through the one DM link rule (pushTapRouter coachDmLink). The push data is the server's (backend 9d0db7eb
 * community-dms.service.ts:236 and community-notifications.service.ts:274: kind community_dm_received, deepLink
 * tgp://community/dm/<sender>, no actionScreen). Real pushNotifications (installNotificationResponseHandler,
 * installForegroundHandler), foregroundBannerStore, ForegroundNotificationBanner and pushTapRouter; expo-notifications
 * is mocked at its edge (as coachDmPushTap.test.tsx and foregroundBannerTap.test.tsx). Every switch on ([R27]); case 14
 * turns communityTab off. Ids are fictional UUIDs (the client's resolveAppLink opens community/dm/<id> only for one).
 */
import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockGetLast = jest.fn(() => Promise.resolve(null as unknown));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
const mockFlags: Record<string, unknown> = {};
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  for (const [k, v] of Object.entries(actual.featureFlags)) mockFlags[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: mockFlags };
});
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { textPrimary: '#1A1A18', textOnPrimary: '#FFFDF8', primary: '#4A0404', primaryPale: '#EFE6DC' } }),
}));
// The banner's own navigate; the router never uses it.
const mockScreenNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockScreenNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));

import type { PushRole } from '../pushTapRouter';

// Required after the switches are pinned (an import would run before mockFlags exists).
const ForegroundNotificationBanner = require('../../components/ForegroundNotificationBanner').default;
const { foregroundBannerStore } = require('../../store/foregroundBannerStore');
const { installForegroundHandler, installNotificationResponseHandler, pushTapOf } = require('../pushNotifications');
const {
  __resetPushTapRouterForTests, attachPushNavigator, pushTapLanding, routePushTap, setPushSession,
} = require('../pushTapRouter');

const WS = '10000000-0000-4000-8000-000000000000';
const COACH = '20000000-0000-4000-8000-000000000000';
const CLIENT = '30000000-0000-4000-8000-000000000000';
const MEMBER = '40000000-0000-4000-8000-000000000000';
const OTHER_ACCOUNT = '50000000-0000-4000-8000-000000000000';
const CLIENT_TABS = ['Home', 'WorkoutTab', 'CommunityTab', 'MoreTab'];
const COACH_TABS = ['CommandCenter', 'Templates', 'MoneyStack', 'CalendarStack', 'Messages', 'ClientsStack', 'CommunityStack', 'SettingsStack'];
const TITLE = 'Direct message';
const BODY = 'You have a new direct message.';

/** The client's thread with this person: the Community tab's stack, its root kept beneath (incomingLinks.ts:85). */
const clientThread = (id: string) => ['CommunityTab', { screen: 'CommunityDmThread', params: { recipientId: id }, initial: false }];
const COMMUNITY_TAB = ['CommunityTab', undefined];
/** The device data of a community DM push (community-notifications.service.ts:262-274; push-delivery adds kind). */
const dmData = (deepLink: string) => ({ kind: 'community_dm_received', category: 'community', target_type: 'dm', target_id: COACH, deepLink });
const response = (id: string, data: Record<string, unknown>) => ({
  notification: { request: { identifier: id, content: { title: TITLE, body: BODY, data } } },
});
const pairLink = (a: string, b: string) => `tgp://community/dms/${WS}:${[a, b].sort().join(':')}`;

const navigate = jest.fn();
function attach(role: PushRole) {
  attachPushNavigator({ isReady: () => true, navigate, getRootState: () => ({ routeNames: role === 'coach' ? COACH_TABS : CLIENT_TABS, routes: [] }) } as never);
}
function signIn(role: PushRole, userId: string) {
  attach(role);
  setPushSession({ kind: 'app', userId, role });
}
const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };

let tap: (r: unknown) => void;
let stopResponse: () => void;
beforeEach(() => {
  for (const k of Object.keys(mockFlags)) if (typeof mockFlags[k] === 'boolean') mockFlags[k] = true;
  __resetPushTapRouterForTests();
  navigate.mockReset();
  mockScreenNavigate.mockReset();
  mockAddResponse.mockClear();
  mockGetLast.mockReset().mockImplementation(() => Promise.resolve(null));
  stopResponse = installNotificationResponseHandler(routePushTap);
  tap = mockAddResponse.mock.calls[mockAddResponse.mock.calls.length - 1][0] as (r: unknown) => void;
});
afterEach(() => stopResponse());

describe('COACH-DM-CLIENT-M: the client\'s DM device push', () => {
  it('case 1: opens the coach\'s thread once; the same notification tapped again opens nothing', () => {
    signIn('student', CLIENT);
    tap(response('push-dm-1', dmData(`tgp://community/dm/${COACH}`)));
    tap(response('push-dm-1', dmData(`tgp://community/dm/${COACH}`)));
    expect(navigate.mock.calls).toEqual([clientThread(COACH)]);
  });

  it('case 1: a push from another member opens that member\'s thread, not the coach\'s', () => {
    signIn('student', CLIENT);
    tap(response('push-dm-2', dmData(`tgp://community/dm/${MEMBER}`)));
    expect(navigate.mock.calls).toEqual([clientThread(MEMBER)]);
  });

  it('case 5: an older pair link holding the client opens the other id; one naming neither lands on the Community tab', () => {
    signIn('student', CLIENT);
    tap(response('push-dm-3', dmData(pairLink(CLIENT, COACH))));
    tap(response('push-dm-4', dmData(pairLink(COACH, MEMBER))));
    expect(navigate.mock.calls).toEqual([clientThread(COACH), COMMUNITY_TAB]);
  });

  it('case 6: tgp://community/dm/<id>?workspace=<uuid> opens the same thread; nothing reads the query', () => {
    signIn('student', CLIENT);
    tap(response('push-dm-5', dmData(`tgp://community/dm/${COACH}?workspace=${WS}`)));
    expect(navigate.mock.calls).toEqual([clientThread(COACH)]);
  });

  it('case 14: with communityTab off the push lands where it does at the base (the client\'s Notifications list)', () => {
    mockFlags.communityTab = false;
    signIn('student', CLIENT);
    tap(response('push-dm-6', dmData(`tgp://community/dm/${COACH}`)));
    expect(navigate.mock.calls).toEqual([['Home', { screen: 'NotificationCenter', params: undefined }]]);
    const t = pushTapOf(dmData(`tgp://community/dm/${COACH}`));
    expect(pushTapLanding(CLIENT_TABS, t.actionScreen, t.actionParams, t.deepLink)).toEqual({ name: 'NotificationCenter', params: undefined });
  });
});

describe('COACH-DM-CLIENT-M: a tap held for the signed-in account', () => {
  it('case 3: a cold-start tap is held until the client\'s tabs mount, then opened once', async () => {
    stopResponse();
    __resetPushTapRouterForTests();
    mockGetLast.mockReturnValueOnce(Promise.resolve(response('cold-dm-1', dmData(`tgp://community/dm/${COACH}`))));
    stopResponse = installNotificationResponseHandler(routePushTap);
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    signIn('student', CLIENT);
    expect(navigate.mock.calls).toEqual([clientThread(COACH)]);
    setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('case 7: held while the account is still onboarding, it opens once the client\'s tabs are up (control)', () => {
    attach('student');
    setPushSession({ kind: 'onboarding', userId: CLIENT });
    tap(response('held-dm-1', dmData(`tgp://community/dm/${COACH}`)));
    expect(navigate).not.toHaveBeenCalled();
    setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
    expect(navigate.mock.calls).toEqual([clientThread(COACH)]);
  });

  it('case 7: signed out between tap and delivery, the tap is dropped; the next sign-in opens nothing', () => {
    attach('student');
    setPushSession({ kind: 'onboarding', userId: CLIENT });
    tap(response('held-dm-2', dmData(`tgp://community/dm/${COACH}`)));
    setPushSession({ kind: 'signedOut' });
    setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('case 7: another account signing in on the same phone opens nothing', () => {
    attach('student');
    setPushSession({ kind: 'onboarding', userId: CLIENT });
    tap(response('held-dm-3', dmData(`tgp://community/dm/${COACH}`)));
    setPushSession({ kind: 'app', userId: OTHER_ACCOUNT, role: 'student' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('case 7: a cold-start tap (owner unknown) is dropped by a sign-out before any account', async () => {
    stopResponse();
    __resetPushTapRouterForTests();
    mockGetLast.mockReturnValueOnce(Promise.resolve(response('cold-dm-2', dmData(`tgp://community/dm/${COACH}`))));
    stopResponse = installNotificationResponseHandler(routePushTap);
    await flush();
    setPushSession({ kind: 'signedOut' });
    signIn('student', OTHER_ACCOUNT);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('COACH-DM-CLIENT-M: the same push as the in-app banner (case 2)', () => {
  let stopReceived: () => void;
  let receive: (n: unknown) => void;
  beforeAll(() => {
    stopReceived = installForegroundHandler();
    receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
  });
  afterAll(() => stopReceived());
  afterEach(async () => { await act(async () => foregroundBannerStore.getState().reset()); });

  it('case 2: the banner tap opens the thread the device tap opens, once, and pushTapLanding answers that thread', async () => {
    const data = dmData(`tgp://community/dm/${COACH}`);
    const t = pushTapOf(data);
    expect(pushTapLanding(CLIENT_TABS, t.actionScreen, t.actionParams, t.deepLink)).toEqual({
      name: 'CommunityDmThread', params: { recipientId: COACH },
    });
    signIn('student', CLIENT);
    await act(async () => receive(response('banner-dm-1', data).notification));
    const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
      start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
    } as never);
    const view = await render(<ForegroundNotificationBanner />);
    await fireEvent.press(view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`));
    timing.mockRestore();
    await view.unmount();
    expect(navigate.mock.calls).toEqual([clientThread(COACH)]);
    expect(mockScreenNavigate).not.toHaveBeenCalled();
  });
});

describe('COACH-DM-CLIENT-M: a coach is unchanged (case 8)', () => {
  it('case 8: a coach\'s DM push and pushTapLanding still open that client\'s thread in the coach\'s Community stack', () => {
    signIn('coach', COACH);
    tap(response('coach-dm-1', dmData(`tgp://community/dm/${CLIENT}`)));
    tap(response('coach-dm-2', dmData(pairLink(COACH, CLIENT))));
    const coachThread = ['CommunityStack', { screen: 'CommunityDmThread', params: { recipientId: CLIENT }, initial: false }];
    expect(navigate.mock.calls).toEqual([coachThread, coachThread]);
    const t = pushTapOf(dmData(`tgp://community/dm/${CLIENT}`));
    expect(pushTapLanding(COACH_TABS, t.actionScreen, t.actionParams, t.deepLink)).toEqual({
      name: 'CommunityDmThread', params: { recipientId: CLIENT },
    });
  });
});
