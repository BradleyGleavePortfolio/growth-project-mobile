/**
 * S14 — on-device registration + history import orchestration.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AxiosError, AxiosHeaders } from 'axios';

import {
  MAX_IMPORT_PASSES,
  connectOnDevice,
  deviceSourceFor,
  isIngestDisabledError,
  refreshOnDevice,
  OnDeviceNotSignedInError,
} from '../onDeviceSync';
import {
  getLocalAuthorization,
  recordLocalAuthorization,
  retireOnDeviceState,
} from '../onDeviceState';
import { OnDeviceSessionChangedError } from '../sessionFence';
import type { WearableConnection } from '../../../api/wearablesConnectionsApi';

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

function connection(
  provider: WearableConnection['provider'],
  id = 'conn-1',
  status: WearableConnection['status'] = 'connected',
): WearableConnection {
  return {
    id,
    user_id: 'u1',
    provider,
    external_account_id: 'on-device',
    access_token_expires_at: null,
    scopes: [],
    webhook_subscription_id: null,
    channel_expires_at: null,
    status,
    last_error: null,
    last_synced_at: null,
    backfilled_until: null,
    disconnected_at: null,
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
  };
}

function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError('http', String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
    data,
  });
}

const DISABLED = httpError(503, {
  statusCode: 503,
  code: 'wearables_ingest_disabled',
  message: 'Wearable sample ingest is not enabled',
});

describe('deviceSourceFor', () => {
  it('maps Apple Health on iOS only', () => {
    setPlatform('ios');
    expect(deviceSourceFor('APPLE_HEALTHKIT')).toBe('APPLE_HEALTHKIT');
    expect(deviceSourceFor('HEALTH_CONNECT')).toBeNull();
  });

  it('maps Health Connect and Samsung Health to Health Connect on Android', () => {
    setPlatform('android');
    expect(deviceSourceFor('HEALTH_CONNECT')).toBe('HEALTH_CONNECT');
    expect(deviceSourceFor('SAMSUNG_HEALTH')).toBe('HEALTH_CONNECT');
    expect(deviceSourceFor('APPLE_HEALTHKIT')).toBeNull();
    expect(deviceSourceFor('OURA')).toBeNull();
  });
});

describe('isIngestDisabledError', () => {
  it('matches only the typed 503', () => {
    expect(isIngestDisabledError(DISABLED)).toBe(true);
    expect(isIngestDisabledError(httpError(503, { code: 'other' }))).toBe(false);
    expect(isIngestDisabledError(httpError(500, { code: 'wearables_ingest_disabled' }))).toBe(
      false,
    );
    expect(isIngestDisabledError(new Error('x'))).toBe(false);
  });
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

const user = (id: string | null) => jest.fn().mockResolvedValue(id);
const done = (n = 3) => jest.fn().mockResolvedValue({ postedCount: n, complete: true });
const doneHc = (n = 3) => jest.fn().mockResolvedValue({ normalizedCount: n, complete: true });

describe('connectOnDevice (explicit Connect tap)', () => {
  it('registers, records local authorization for the signed-in user, then imports', async () => {
    const register = jest.fn().mockResolvedValue(connection('APPLE_HEALTHKIT'));
    const syncHealthKit = done(12);
    const out = await connectOnDevice('APPLE_HEALTHKIT', {
      register,
      syncHealthKit,
      readUserId: user('user-a'),
    });
    expect(out).toEqual({ kind: 'imported', source: 'APPLE_HEALTHKIT', postedCount: 12, complete: true });
    expect(register).toHaveBeenCalledWith('APPLE_HEALTHKIT');
    const scope = syncHealthKit.mock.calls[0][0];
    expect(scope).toEqual({ userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' });
    const auth = await getLocalAuthorization('user-a', 'APPLE_HEALTHKIT');
    expect(auth?.connectionId).toBe('conn-1');
  });

  it('syncs Health Connect through the returned connection id', async () => {
    const syncHealthConnect = doneHc(5);
    const out = await connectOnDevice('HEALTH_CONNECT', {
      register: jest.fn().mockResolvedValue(connection('HEALTH_CONNECT', 'conn-hc')),
      syncHealthConnect,
      readUserId: user('user-a'),
    });
    expect(out).toEqual({ kind: 'imported', source: 'HEALTH_CONNECT', postedCount: 5, complete: true });
    expect(syncHealthConnect.mock.calls[0][0].connectionId).toBe('conn-hc');
  });

  it('refuses when nobody is signed in, before registering', async () => {
    const register = jest.fn();
    await expect(
      connectOnDevice('APPLE_HEALTHKIT', { register, readUserId: user(null) }),
    ).rejects.toBeInstanceOf(OnDeviceNotSignedInError);
    expect(register).not.toHaveBeenCalled();
  });

  it('records nothing and reads nothing if the account changed during registration', async () => {
    const readUserId = jest.fn().mockResolvedValueOnce('user-a').mockResolvedValue('user-b');
    const syncHealthKit = done();
    await expect(
      connectOnDevice('APPLE_HEALTHKIT', {
        register: jest.fn().mockResolvedValue(connection('APPLE_HEALTHKIT')),
        syncHealthKit,
        readUserId,
      }),
    ).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    expect(syncHealthKit).not.toHaveBeenCalled();
    expect(await getLocalAuthorization('user-a', 'APPLE_HEALTHKIT')).toBeNull();
    expect(await getLocalAuthorization('user-b', 'APPLE_HEALTHKIT')).toBeNull();
  });

  it('returns disabled when registration hits the switched-off lane', async () => {
    const out = await connectOnDevice('HEALTH_CONNECT', {
      register: jest.fn().mockRejectedValue(DISABLED),
      readUserId: user('user-a'),
    });
    expect(out).toEqual({ kind: 'disabled', source: 'HEALTH_CONNECT' });
  });

  it('returns disabled when the ingest hits the switched-off lane', async () => {
    const out = await connectOnDevice('APPLE_HEALTHKIT', {
      register: jest.fn().mockResolvedValue(connection('APPLE_HEALTHKIT')),
      syncHealthKit: jest.fn().mockRejectedValue(DISABLED),
      readUserId: user('user-a'),
    });
    expect(out).toEqual({ kind: 'disabled', source: 'APPLE_HEALTHKIT' });
  });

  it('rethrows any other failure', async () => {
    await expect(
      connectOnDevice('APPLE_HEALTHKIT', {
        register: jest.fn().mockResolvedValue(connection('APPLE_HEALTHKIT')),
        syncHealthKit: jest.fn().mockRejectedValue(new Error('network')),
        readUserId: user('user-a'),
      }),
    ).rejects.toThrow('network');
  });

  it('continues an incomplete import in further passes, bounded, and reports it incomplete', async () => {
    const syncHealthConnect = jest
      .fn()
      .mockResolvedValue({ normalizedCount: 100, complete: false });
    const out = await connectOnDevice('HEALTH_CONNECT', {
      register: jest.fn().mockResolvedValue(connection('HEALTH_CONNECT')),
      syncHealthConnect,
      readUserId: user('user-a'),
    });
    expect(syncHealthConnect).toHaveBeenCalledTimes(MAX_IMPORT_PASSES);
    expect(out).toEqual({
      kind: 'imported',
      source: 'HEALTH_CONNECT',
      postedCount: 100 * MAX_IMPORT_PASSES,
      complete: false,
    });
  });
});

describe('refreshOnDevice (Health screen open) — A-317-1', () => {
  const remote = [connection('APPLE_HEALTHKIT', 'conn-1')];

  it('never reads the phone for a remote connected row without a local Connect', async () => {
    const syncHealthKit = done();
    const out = await refreshOnDevice('APPLE_HEALTHKIT', remote, {
      syncHealthKit,
      readUserId: user('user-a'),
    });
    expect(out).toEqual({ kind: 'not_authorized', source: 'APPLE_HEALTHKIT' });
    expect(syncHealthKit).not.toHaveBeenCalled();
  });

  it("does not use account A's local Connect for account B on the same phone", async () => {
    await recordLocalAuthorization({ userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' });
    const syncHealthKit = done();
    // B is signed in; B's server row happens to be connected.
    const out = await refreshOnDevice('APPLE_HEALTHKIT', [connection('APPLE_HEALTHKIT', 'conn-b')], {
      syncHealthKit,
      readUserId: user('user-b'),
    });
    expect(out.kind).toBe('not_authorized');
    expect(syncHealthKit).not.toHaveBeenCalled();
  });

  it('requires the SAME connection id the person connected through', async () => {
    await recordLocalAuthorization({ userId: 'user-a', connectionId: 'conn-old', source: 'APPLE_HEALTHKIT' });
    const syncHealthKit = done();
    const out = await refreshOnDevice('APPLE_HEALTHKIT', remote, {
      syncHealthKit,
      readUserId: user('user-a'),
    });
    expect(out.kind).toBe('not_authorized');
    expect(syncHealthKit).not.toHaveBeenCalled();
  });

  it('requires the server row to still be connected', async () => {
    await recordLocalAuthorization({ userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' });
    const syncHealthKit = done();
    const out = await refreshOnDevice(
      'APPLE_HEALTHKIT',
      [connection('APPLE_HEALTHKIT', 'conn-1', 'disconnected')],
      { syncHealthKit, readUserId: user('user-a') },
    );
    expect(out.kind).toBe('not_authorized');
    expect(syncHealthKit).not.toHaveBeenCalled();
  });

  it('refreshes for the user who connected, through their connection', async () => {
    await recordLocalAuthorization({ userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' });
    const syncHealthKit = done(4);
    const out = await refreshOnDevice('APPLE_HEALTHKIT', remote, {
      syncHealthKit,
      readUserId: user('user-a'),
    });
    expect(out).toEqual({ kind: 'imported', source: 'APPLE_HEALTHKIT', postedCount: 4, complete: true });
    expect(syncHealthKit.mock.calls[0][0]).toEqual({
      userId: 'user-a',
      connectionId: 'conn-1',
      source: 'APPLE_HEALTHKIT',
    });
  });

  it('reads nothing after sign-out retired the local state', async () => {
    await recordLocalAuthorization({ userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' });
    await retireOnDeviceState();
    const syncHealthKit = done();
    const out = await refreshOnDevice('APPLE_HEALTHKIT', remote, {
      syncHealthKit,
      readUserId: user('user-a'),
    });
    expect(out.kind).toBe('not_authorized');
    expect(syncHealthKit).not.toHaveBeenCalled();
  });

  it('returns not_authorized when nobody is signed in', async () => {
    const out = await refreshOnDevice('APPLE_HEALTHKIT', remote, { readUserId: user(null) });
    expect(out.kind).toBe('not_authorized');
  });
});
