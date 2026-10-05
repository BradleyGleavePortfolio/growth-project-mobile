/**
 * S14 — account-scoped on-device state (A-317-1 / B-317-1).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ON_DEVICE_STATE_PREFIX,
  getLocalAuthorization,
  getSyncProgress,
  recordLocalAuthorization,
  retireOnDeviceState,
  setSyncProgress,
  type OnDeviceScope,
} from '../onDeviceState';

const A: OnDeviceScope = { userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('local authorization', () => {
  it('is keyed by user + source and bound to the connection id', async () => {
    await recordLocalAuthorization(A, new Date('2026-10-01T00:00:00.000Z'));
    expect(await getLocalAuthorization('user-a', 'APPLE_HEALTHKIT')).toEqual({
      v: 1,
      userId: 'user-a',
      source: 'APPLE_HEALTHKIT',
      connectionId: 'conn-1',
      grantedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(await getLocalAuthorization('user-b', 'APPLE_HEALTHKIT')).toBeNull();
    expect(await getLocalAuthorization('user-a', 'HEALTH_CONNECT')).toBeNull();
  });

  it('rejects a record stored under one user that names another', async () => {
    await AsyncStorage.setItem(
      `${ON_DEVICE_STATE_PREFIX}auth:APPLE_HEALTHKIT:user-b`,
      JSON.stringify({ v: 1, userId: 'user-a', source: 'APPLE_HEALTHKIT', connectionId: 'c', grantedAt: 'x' }),
    );
    expect(await getLocalAuthorization('user-b', 'APPLE_HEALTHKIT')).toBeNull();
  });

  it('ignores corrupt values', async () => {
    await AsyncStorage.setItem(`${ON_DEVICE_STATE_PREFIX}auth:APPLE_HEALTHKIT:user-a`, '{nope');
    expect(await getLocalAuthorization('user-a', 'APPLE_HEALTHKIT')).toBeNull();
  });
});

describe('sync progress', () => {
  it('is separate per user and per connection', async () => {
    await setSyncProgress(A, {
      v: 1,
      completedThrough: { steps: '2026-10-01T00:00:00.000Z' },
      resume: {},
    });
    expect((await getSyncProgress(A)).completedThrough.steps).toBe('2026-10-01T00:00:00.000Z');
    expect((await getSyncProgress({ ...A, userId: 'user-b' })).completedThrough).toEqual({});
    expect((await getSyncProgress({ ...A, connectionId: 'conn-2' })).completedThrough).toEqual({});
  });

  it('drops invalid entries', async () => {
    await setSyncProgress(A, {
      v: 1,
      completedThrough: { steps: 'not-a-date', sleep: '2026-10-01T00:00:00.000Z' },
      resume: { Steps: { startTime: 'a', endTime: 'b', pageToken: '' } },
    });
    const p = await getSyncProgress(A);
    expect(p.completedThrough).toEqual({ sleep: '2026-10-01T00:00:00.000Z' });
    expect(p.resume).toEqual({});
  });
});

describe('retireOnDeviceState', () => {
  it('with a source removes only that source (disconnect)', async () => {
    await recordLocalAuthorization(A);
    await setSyncProgress(A, { v: 1, completedThrough: {}, resume: {} });
    const hc: OnDeviceScope = { ...A, source: 'HEALTH_CONNECT' };
    await recordLocalAuthorization(hc);
    await retireOnDeviceState('APPLE_HEALTHKIT');
    expect(await getLocalAuthorization('user-a', 'APPLE_HEALTHKIT')).toBeNull();
    expect(await getLocalAuthorization('user-a', 'HEALTH_CONNECT')).not.toBeNull();
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some((k) => k.includes('progress:APPLE_HEALTHKIT'))).toBe(false);
  });

  it('without a source removes everything under the prefix and nothing else', async () => {
    await recordLocalAuthorization(A);
    await AsyncStorage.setItem('unrelated', 'x');
    await retireOnDeviceState();
    expect(await AsyncStorage.getAllKeys()).toEqual(['unrelated']);
  });
});
