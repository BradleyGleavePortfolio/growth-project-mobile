/**
 * Rule 28: sign-in must not show the OS push prompt, and the tap handler
 * must be installed at the app root.
 */
import * as fs from 'fs';
import * as path from 'path';

const mockGetPerms = jest.fn();
const mockRequestPerms = jest.fn();
const mockGetToken = jest.fn();
const mockAddResponse = jest.fn();
const mockGetLast = jest.fn();
const mockClearLast = jest.fn(() => Promise.resolve());
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockGetPerms(),
  requestPermissionsAsync: () => mockRequestPerms(),
  getExpoPushTokenAsync: () => mockGetToken(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => mockGetLast(),
  clearLastNotificationResponseAsync: () => mockClearLast(),
  AndroidImportance: { MAX: 5 },
}));

import {
  registerForPushNotifications,
  installNotificationResponseHandler,
  fallbackScreenForKind,
} from '../pushNotifications';

function response(id: string, data: Record<string, unknown>) {
  return { notification: { request: { identifier: id, content: { data } } } };
}

describe('registerForPushNotifications', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requestPermission:false never prompts when permission is undetermined', async () => {
    mockGetPerms.mockResolvedValue({ status: 'undetermined' });
    const res = await registerForPushNotifications({ requestPermission: false });
    expect(res).toEqual({ token: null, granted: false });
    expect(mockRequestPerms).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('requestPermission:false still registers the token when already granted', async () => {
    mockGetPerms.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const res = await registerForPushNotifications({ requestPermission: false });
    expect(res).toEqual({ token: 'ExponentPushToken[abc]', granted: true });
    expect(mockRequestPerms).not.toHaveBeenCalled();
  });

  it('default (explicit opt-in) still prompts', async () => {
    mockGetPerms.mockResolvedValue({ status: 'undetermined' });
    mockRequestPerms.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'tok' });
    const res = await registerForPushNotifications();
    expect(mockRequestPerms).toHaveBeenCalledTimes(1);
    expect(res.token).toBe('tok');
  });
});

describe('installNotificationResponseHandler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes live taps and the cold-start tap with their ids', async () => {
    let live: ((r: unknown) => void) | undefined;
    mockAddResponse.mockImplementation((cb: (r: unknown) => void) => {
      live = cb;
      return { remove: jest.fn() };
    });
    mockGetLast.mockResolvedValue(response('cold', { actionScreen: 'Messages' }));
    const onResponse = jest.fn();
    const cleanup = installNotificationResponseHandler(onResponse);
    await Promise.resolve();
    await Promise.resolve();
    expect(onResponse).toHaveBeenCalledWith('Messages', undefined, 'cold');
    live?.(response('warm', { actionScreen: 'Timeline', actionParams: { id: 'm1' } }));
    expect(onResponse).toHaveBeenCalledWith('Timeline', { id: 'm1' }, 'warm');
    cleanup();
  });

  it('C3: consumes the cold-start response after routing it, so a remount cannot re-route it', async () => {
    mockAddResponse.mockImplementation(() => ({ remove: jest.fn() }));
    mockGetLast.mockResolvedValueOnce(response('cold', { actionScreen: 'Messages' })).mockResolvedValue(null);
    const onResponse = jest.fn();
    installNotificationResponseHandler(onResponse)();
    await Promise.resolve();
    await Promise.resolve();
    // cleanup ran before the promise resolved: nothing routed, nothing consumed
    expect(onResponse).not.toHaveBeenCalled();
    mockGetLast.mockReset();
    mockGetLast.mockResolvedValueOnce(response('cold', { actionScreen: 'Messages' })).mockResolvedValue(null);
    const cleanup = installNotificationResponseHandler(onResponse);
    await Promise.resolve();
    await Promise.resolve();
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(mockClearLast).toHaveBeenCalledTimes(1);
    cleanup();
    // Remount (e.g. JS reload): native store is now empty, so no replay.
    const again = installNotificationResponseHandler(onResponse);
    await Promise.resolve();
    await Promise.resolve();
    expect(onResponse).toHaveBeenCalledTimes(1);
    again();
  });
});

describe('AUDIT-09-125: a push without actionScreen still opens a screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes by kind: community, workout reminder, everything else to the notification center', () => {
    let live: ((r: unknown) => void) | undefined;
    mockAddResponse.mockImplementation((cb: (r: unknown) => void) => {
      live = cb;
      return { remove: jest.fn() };
    });
    mockGetLast.mockResolvedValue(null);
    const onResponse = jest.fn();
    const cleanup = installNotificationResponseHandler(onResponse);
    live?.(response('c1', { kind: 'community_post_replied', target_id: 'p1' }));
    expect(onResponse).toHaveBeenLastCalledWith('Community', undefined, 'c1');
    live?.(response('w1', { kind: 'workout_reminder', deep_link: 'tgp://workouts' }));
    expect(onResponse).toHaveBeenLastCalledWith('WorkoutMain', undefined, 'w1');
    live?.(response('n1', { kind: 'nudge_missed_checkin' }));
    expect(onResponse).toHaveBeenLastCalledWith('NotificationCenter', undefined, 'n1');
    live?.(response('m1', { kind: 'message_received', actionScreen: 'Messages' }));
    expect(onResponse).toHaveBeenLastCalledWith('Messages', undefined, 'm1');
    live?.(response('x1', {}));
    expect(onResponse).toHaveBeenLastCalledWith(undefined, undefined, 'x1');
    cleanup();
  });

  it('fallbackScreenForKind ignores a missing or non-string kind', () => {
    expect(fallbackScreenForKind(undefined)).toBeUndefined();
    expect(fallbackScreenForKind(7)).toBeUndefined();
    expect(fallbackScreenForKind('')).toBeUndefined();
  });
});

describe('app wiring (source guards)', () => {
  const APP = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'App.tsx'), 'utf8');
  it('App.tsx installs the tap handler once, routed through pushTapRouter', () => {
    expect(APP).toMatch(/return installNotificationResponseHandler\(routePushTap\);\s*\n\s*\}, \[\]\);/);
  });
  it('sign-in token registration never requests permission', () => {
    expect(APP).toMatch(/registerForPushNotifications\(\{ requestPermission: false \}\)/);
    expect(APP).not.toMatch(/registerForPushNotifications\(\)/);
  });
});
