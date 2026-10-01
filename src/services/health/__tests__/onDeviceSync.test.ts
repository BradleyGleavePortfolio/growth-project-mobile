/**
 * S14 — on-device registration + history import orchestration.
 */

import { Platform } from 'react-native';
import { AxiosError, AxiosHeaders } from 'axios';

import { deviceSourceFor, importOnDeviceHistory, isIngestDisabledError } from '../onDeviceSync';
import type { WearableConnection } from '../../../api/wearablesConnectionsApi';

function setPlatform(os: string): void {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

function connection(provider: WearableConnection['provider']): WearableConnection {
  return {
    id: 'conn-1',
    user_id: 'u1',
    provider,
    external_account_id: 'on-device',
    access_token_expires_at: null,
    scopes: [],
    webhook_subscription_id: null,
    channel_expires_at: null,
    status: 'connected',
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

describe('importOnDeviceHistory', () => {
  it('registers, then syncs Apple Health through the returned connection id', async () => {
    const register = jest.fn().mockResolvedValue(connection('APPLE_HEALTHKIT'));
    const syncHealthKit = jest.fn().mockResolvedValue({ postedCount: 12 });
    const out = await importOnDeviceHistory('APPLE_HEALTHKIT', {
      register,
      syncHealthKit,
    });
    expect(register).toHaveBeenCalledWith('APPLE_HEALTHKIT');
    expect(syncHealthKit).toHaveBeenCalledWith('conn-1');
    expect(out).toEqual({
      kind: 'imported',
      source: 'APPLE_HEALTHKIT',
      postedCount: 12,
    });
  });

  it('registers, then syncs Health Connect through the returned connection id', async () => {
    const register = jest.fn().mockResolvedValue(connection('HEALTH_CONNECT'));
    const syncHealthConnect = jest.fn().mockResolvedValue({ normalizedCount: 5 });
    const out = await importOnDeviceHistory('HEALTH_CONNECT', {
      register,
      syncHealthConnect,
    });
    expect(syncHealthConnect).toHaveBeenCalledWith('conn-1');
    expect(out).toEqual({
      kind: 'imported',
      source: 'HEALTH_CONNECT',
      postedCount: 5,
    });
  });

  it('reports disabled (no read) while the server lane is off', async () => {
    const register = jest.fn().mockRejectedValue(DISABLED);
    const syncHealthKit = jest.fn();
    const out = await importOnDeviceHistory('APPLE_HEALTHKIT', {
      register,
      syncHealthKit,
    });
    expect(out).toEqual({ kind: 'disabled', source: 'APPLE_HEALTHKIT' });
    expect(syncHealthKit).not.toHaveBeenCalled();
  });

  it('rethrows other failures so the caller can offer a retry', async () => {
    const register = jest.fn().mockResolvedValue(connection('APPLE_HEALTHKIT'));
    const syncHealthKit = jest.fn().mockRejectedValue(httpError(500, {}));
    await expect(
      importOnDeviceHistory('APPLE_HEALTHKIT', { register, syncHealthKit }),
    ).rejects.toBeInstanceOf(AxiosError);
  });
});
