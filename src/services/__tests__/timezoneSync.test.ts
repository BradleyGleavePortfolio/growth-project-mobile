import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppStateStatus } from 'react-native';
import {
  deviceTimezone,
  installTimezoneResyncOnForeground,
  sessionSubject,
  syncDeviceTimezone,
  TIMEZONE_SYNC_KEY,
} from '../timezoneSync';
import { notificationsApi } from '../api';

// C05 item 7 — workout reminders use the client's local timezone, so the
// device IANA zone is synced to the backend once per change and per account.
// Backend contract (#647): PUT /notifications/timezone { timezone, source:
// 'device' } (string, max 64) stores the zone with provenance; 400
// TIMEZONE_INVALID for an unknown name. B-NOTIF-6: a backend without that
// route (404/405) gets PATCH /notifications/preferences { timezone } (#609).

jest.mock('../api', () => ({
  notificationsApi: { updatePreferences: jest.fn(), setTimezone: jest.fn() },
}));

const mockSend = notificationsApi.setTimezone as jest.Mock;
const mockPatch = notificationsApi.updatePreferences as jest.Mock;

function token(sub: string): string {
  const b64url = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub })}.signature`;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSend.mockResolvedValue({ data: { stored: true } });
  mockPatch.mockResolvedValue({ data: {} });
});

describe('timezoneSync', () => {
  it('reads an IANA zone from the device', () => {
    const tz = deviceTimezone();
    expect(typeof tz).toBe('string');
    expect((tz ?? '').length).toBeGreaterThan(0);
  });

  it('reads the account from the session token, and nothing from a malformed one', () => {
    expect(sessionSubject(token('user-a'))).toBe('user-a');
    expect(sessionSubject('not-a-jwt')).toBeNull();
    expect(sessionSubject('a.%%%.c')).toBeNull();
    expect(sessionSubject(null)).toBeNull();
    expect(sessionSubject(undefined)).toBeNull();
  });

  it('sends the zone once per account, then only when it changes', async () => {
    const tz = deviceTimezone();
    expect(await syncDeviceTimezone(token('user-a'))).toBe(true);
    expect(mockSend).toHaveBeenCalledWith(tz);
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBe(`user-a|${tz}`);
    expect(await syncDeviceTimezone(token('user-a'))).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
    await AsyncStorage.setItem(TIMEZONE_SYNC_KEY, 'user-a|Pacific/Chatham');
    expect(await syncDeviceTimezone(token('user-a'))).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('a second account signing in on the same device syncs its own row', async () => {
    expect(await syncDeviceTimezone(token('user-a'))).toBe(true);
    expect(await syncDeviceTimezone(token('user-b'))).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBe(`user-b|${deviceTimezone()}`);
  });

  it('without a readable account it always sends and caches nothing', async () => {
    expect(await syncDeviceTimezone(null)).toBe(true);
    expect(await syncDeviceTimezone('opaque')).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBeNull();
  });

  it('does not cache a failed sync, so it retries next time', async () => {
    mockSend.mockRejectedValueOnce(new Error('offline'));
    await expect(syncDeviceTimezone(token('user-a'))).rejects.toThrow('offline');
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBeNull();
    expect(await syncDeviceTimezone(token('user-a'))).toBe(true);
  });
});

describe('C-312-3: resync when the app returns to the foreground', () => {
  function fakeAppState(initial: AppStateStatus) {
    const listeners = new Set<(s: AppStateStatus) => void>();
    const appState = {
      currentState: initial,
      addEventListener: (_type: 'change', fn: (s: AppStateStatus) => void) => {
        listeners.add(fn);
        return { remove: () => listeners.delete(fn) };
      },
    };
    const emit = async (next: AppStateStatus) => {
      appState.currentState = next;
      listeners.forEach((fn) => fn(next));
      // Let the token read and the sync settle.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    };
    return { appState, emit, listeners };
  }

  it('a client who travelled with the app open is synced on resume, once', async () => {
    // Synced earlier in another zone (the trip started with the app open).
    await AsyncStorage.setItem(TIMEZONE_SYNC_KEY, 'user-a|Pacific/Chatham');
    const { appState, emit } = fakeAppState('active');
    installTimezoneResyncOnForeground(async () => token('user-a'), appState);
    await emit('background');
    expect(mockSend).not.toHaveBeenCalled();
    await emit('active');
    expect(mockSend).toHaveBeenCalledWith(deviceTimezone());
    // A second resume in the same zone sends nothing (stamp matches).
    await emit('inactive');
    await emit('active');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('active to active is not a resume; signed out sends nothing; unsubscribe stops it', async () => {
    const { appState, emit, listeners } = fakeAppState('active');
    let signedIn = false;
    const stop = installTimezoneResyncOnForeground(
      async () => (signedIn ? token('user-b') : null),
      appState,
    );
    await emit('active');
    await emit('background');
    await emit('active');
    expect(mockSend).not.toHaveBeenCalled();
    signedIn = true;
    stop();
    expect(listeners.size).toBe(0);
    await emit('background');
    await emit('active');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('a failed resync is handed to onError and retried on the next resume', async () => {
    const onError = jest.fn();
    mockSend.mockRejectedValueOnce(new Error('offline'));
    const { appState, emit } = fakeAppState('background');
    installTimezoneResyncOnForeground(async () => token('user-c'), appState, onError);
    await emit('active');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    await emit('background');
    await emit('active');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('B-NOTIF-6: the device zone is stored with provenance', () => {
  function httpError(status: number) {
    return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
  }

  it('sign-in sends PUT /notifications/timezone (source device), not the preferences PATCH', async () => {
    expect(await syncDeviceTimezone(token('user-a'))).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(deviceTimezone());
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('a backend without the route (404 or 405) gets the preferences PATCH, and the zone is cached', async () => {
    for (const status of [404, 405]) {
      await AsyncStorage.clear();
      mockSend.mockRejectedValueOnce(httpError(status));
      expect(await syncDeviceTimezone(token('user-a'))).toBe(true);
      expect(mockPatch).toHaveBeenLastCalledWith({ timezone: deviceTimezone() });
      expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBe(`user-a|${deviceTimezone()}`);
    }
    expect(mockPatch).toHaveBeenCalledTimes(2);
  });

  it('a zone the backend rejects (400) is not cached and does not fall back', async () => {
    mockSend.mockRejectedValueOnce(httpError(400));
    await expect(syncDeviceTimezone(token('user-a'))).rejects.toThrow('HTTP 400');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBeNull();
  });

  it('a failed fallback is not cached either', async () => {
    mockSend.mockRejectedValueOnce(httpError(404));
    mockPatch.mockRejectedValueOnce(new Error('offline'));
    await expect(syncDeviceTimezone(token('user-a'))).rejects.toThrow('offline');
    expect(await AsyncStorage.getItem(TIMEZONE_SYNC_KEY)).toBeNull();
  });

  it('a foreground resume uses the same route', async () => {
    await AsyncStorage.setItem(TIMEZONE_SYNC_KEY, 'user-a|Pacific/Chatham');
    let listener: ((s: AppStateStatus) => void) | null = null;
    installTimezoneResyncOnForeground(async () => token('user-a'), {
      currentState: 'background',
      addEventListener: (_t, fn) => {
        listener = fn;
        return { remove: () => undefined };
      },
    });
    (listener as unknown as (s: AppStateStatus) => void)('active');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSend).toHaveBeenCalledWith(deviceTimezone());
    expect(mockPatch).not.toHaveBeenCalled();
  });
});
