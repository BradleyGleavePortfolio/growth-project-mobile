/**
 * COACH-ROW-CHAT (owner 203-D4): only the coach's notification-list row names its client (payload senderName and
 * threadId), so only the row opens that client's chat. The device push carries no name and no client id
 * (growth-project-backend 579104f0 notifications.service.ts:666-677 pushTapData :1113-1141, plus kind from
 * push-delivery.service.ts:304; lock-screen-copy.ts:27-30 names nobody), so the push, the in-app banner and a cold-start
 * push keep opening the inbox until the server sends both (follow-up COACH-ROW-CHAT-BE). The client app's message row
 * still opens Home > Messages with the same navigate as before.
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
jest.mock('../../config/featureFlags', () => ({ featureFlags: { coachTabsV2: true, romanChat: true } }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { textPrimary: '#1A1A18', textOnPrimary: '#FFFDF8', primary: '#4A0404', primaryPale: '#EFE6DC' } }),
}));
const mockScreenNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockScreenNavigate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import ForegroundNotificationBanner from '../../components/ForegroundNotificationBanner';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';
import { installForegroundHandler, installNotificationResponseHandler } from '../pushNotifications';
import { normalizeNotification } from '../notificationsApi';
import { __resetPushTapRouterForTests, attachPushNavigator, routePushTap, setPushSession } from '../pushTapRouter';

const CLIENT = '0b9a2a52-6f0e-4c39-9d43-2f1f3c1f6a01';
const COACH = 'b1c2d3e4-0000-4000-8000-00000000c0a1';
const INBOX = ['Messages', { screen: 'MessagesInbox', pop: true }];
const COACH_TABS = ['CommandCenter', 'ProgramsStack', 'MoneyStack', 'CalendarStack', 'Messages', 'ClientsStack'];

/** The push for a coach (message-received.emitter.ts:51-65 -> pushTapData; push-delivery.service.ts:304 adds kind). */
const pushData = { actionScreen: 'Messages', deepLink: `tgp://messages/${CLIENT}`, kind: 'message_received' };
const response = (id: string) => ({ notification: { request: { identifier: id, content: { title: 'New message', body: 'You have a new message. Open the app to read it.', data: pushData } } } });

const navigate = jest.fn();
const dispatch = jest.fn();
function attach(routeNames = COACH_TABS) {
  attachPushNavigator({ isReady: () => true, navigate, dispatch, getRootState: () => ({ routeNames, routes: [] }) } as never);
}

beforeEach(() => {
  __resetPushTapRouterForTests();
  navigate.mockClear();
  dispatch.mockClear();
  mockAddResponse.mockClear();
  mockAddReceived.mockClear();
});

it('the push tap (dispatchResponse) opens the inbox: the push names no client (COACH-ROW-CHAT-BE)', () => {
  attach();
  setPushSession({ kind: 'app', userId: COACH, role: 'coach' });
  const stop = installNotificationResponseHandler(routePushTap);
  const listener = mockAddResponse.mock.calls[0][0] as (r: unknown) => void;
  listener(response('push-1'));
  expect(navigate.mock.calls).toEqual([INBOX]);
  expect(dispatch).not.toHaveBeenCalled();
  stop();
});

it('the foreground banner tap opens the inbox', async () => {
  attach();
  setPushSession({ kind: 'app', userId: COACH, role: 'coach' });
  const stop = installForegroundHandler();
  const listener = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
  await act(async () => listener(response('banner-1').notification));
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
  } as never);
  const view = await render(<ForegroundNotificationBanner />);
  await fireEvent.press(view.getByLabelText('New message. You have a new message. Open the app to read it.. Tap to view.'));
  expect(navigate.mock.calls).toEqual([INBOX]);
  expect(mockScreenNavigate).not.toHaveBeenCalled();
  timing.mockRestore();
  stop();
  await act(async () => foregroundBannerStore.getState().reset());
});

it.each([
  ['the same coach signs in', COACH, [INBOX]],
  ['another user signs in', 'b1c2d3e4-0000-4000-8000-00000000c0a2', []],
])('a cold-start push held while the session is unknown: %s', async (_name, userId, delivered) => {
  attach();
  setPushSession({ kind: 'unknown' });
  mockGetLast.mockReturnValueOnce(Promise.resolve(response('cold-1')));
  const stop = installNotificationResponseHandler(routePushTap);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(navigate).not.toHaveBeenCalled();
  setPushSession({ kind: 'onboarding', userId: COACH });
  setPushSession({ kind: 'app', userId, role: 'coach' });
  expect(navigate.mock.calls).toEqual(delivered);
  stop();
});

it('a cold-start push is dropped when the session signs out', async () => {
  attach();
  setPushSession({ kind: 'unknown' });
  mockGetLast.mockReturnValueOnce(Promise.resolve(response('cold-2')));
  const stop = installNotificationResponseHandler(routePushTap);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  setPushSession({ kind: 'signedOut' });
  setPushSession({ kind: 'app', userId: COACH, role: 'coach' });
  expect(navigate).not.toHaveBeenCalled();
  stop();
});

it("the client app's message row still opens Home > Messages with today's navigate (no chat keys)", () => {
  attach(['Home', 'WorkoutTab', 'MoreTab']);
  setPushSession({ kind: 'app', userId: CLIENT, role: 'student' });
  // messaging.service.ts:910 notifyNewMessage(clientId, coachId, ...): the client's row names the coach, threadId = the client.
  const row = normalizeNotification({
    id: 'n-client', user_id: CLIENT, kind: 'message_received', payload: { senderName: 'Alex', threadId: CLIENT },
    body: 'New message from Alex', deep_link: `tgp://messages/${CLIENT}`, channel: 'inapp', read_at: null,
    created_at: '2026-11-09T20:00:00.000Z', ai_draft_id: null, inbox_hidden: false,
  });
  routePushTap(row?.actionScreen, row?.actionParams, undefined, row?.deepLink); // NotificationCenterScreen.tsx:88
  expect(navigate.mock.calls).toEqual([['Home', { screen: 'Messages', params: undefined }]]);
  expect(Object.keys(navigate.mock.calls[0][1])).toEqual(['screen', 'params']);
  expect(navigate.mock.calls[0][1].params).toBeUndefined();
});

it('a coach message row maps its payload to the chat params; a row with no real name maps none', () => {
  const row = (senderName: string) => normalizeNotification({
    id: 'n', user_id: COACH, kind: 'message_received', payload: { senderName, threadId: CLIENT },
    body: `New message from ${senderName}`, deep_link: `tgp://messages/${CLIENT}`, channel: 'inapp', read_at: null,
    created_at: '2026-11-09T20:00:00.000Z', ai_draft_id: null, inbox_hidden: false,
  });
  expect(row('Dana')).toMatchObject({ actionScreen: 'Messages', actionParams: { clientId: CLIENT, clientName: 'Dana' } });
  for (const none of ['Your coach', '', '   ']) expect(row(none)?.actionParams).toBeUndefined();
});
