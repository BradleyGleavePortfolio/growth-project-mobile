/**
 * wearablesConnectionsApi — wire-contract tests against backend PR-HK-1.
 *
 * Mocks the axios instance at `../services/api` (the repo's established test
 * seam — see messagesApi.test.ts) and asserts, for EVERY endpoint:
 *   • the exact URL + HTTP method + payload mobile sends, and
 *   • a Zod parse-SUCCESS path (valid backend shape → typed object), and
 *   • a Zod parse-FAILURE path (drifted backend shape → throws), so a future
 *     contract drift trips the suite instead of feeding malformed data into
 *     React state.
 *
 * Backend contract source of truth:
 *   growth-project-backend/src/wearables/connections/connections.controller.ts
 *   growth-project-backend/src/wearables/connections/types.ts
 */

import {
  wearablesConnectionsApi,
  configFor,
  isOnDeviceProvider,
  providerAuthModel,
  PROVIDER_CONFIG,
  WEARABLE_PROVIDERS,
  type WearableConnection,
} from './wearablesConnectionsApi';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
});

// A fully-populated valid connection matching SafeWearableConnection.
function validConnection(
  overrides: Partial<WearableConnection> = {},
): WearableConnection {
  return {
    id: 'conn-1',
    user_id: 'user-1',
    provider: 'OURA',
    external_account_id: 'oura-acct-9',
    access_token_expires_at: '2026-06-01T00:00:00.000Z',
    scopes: ['daily', 'heartrate'],
    webhook_subscription_id: 'sub-1',
    channel_expires_at: null,
    status: 'connected',
    last_error: null,
    last_synced_at: '2026-05-31T09:00:00.000Z',
    backfilled_until: '2026-05-01T00:00:00.000Z',
    disconnected_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-31T09:00:00.000Z',
    ...overrides,
  };
}

describe('wearablesConnectionsApi.list', () => {
  it('GETs /v1/wearables/connections and parses the array', async () => {
    api.get.mockResolvedValueOnce({ data: [validConnection()] });

    const res = await wearablesConnectionsApi.list();

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/v1/wearables/connections');
    expect(res).toHaveLength(1);
    expect(res[0].provider).toBe('OURA');
    expect(res[0].status).toBe('connected');
    expect(res[0].scopes).toEqual(['daily', 'heartrate']);
    expect(res[0].last_synced_at).toBe('2026-05-31T09:00:00.000Z');
  });

  it('accepts forward-compatible unknown status strings (free-form column)', async () => {
    api.get.mockResolvedValueOnce({
      data: [validConnection({ status: 'reconnecting_soon' })],
    });
    const res = await wearablesConnectionsApi.list();
    expect(res[0].status).toBe('reconnecting_soon');
  });

  it('throws (Zod) when a connection is missing a required field', async () => {
    const bad = validConnection() as Record<string, unknown>;
    delete bad.scopes; // required array missing
    api.get.mockResolvedValueOnce({ data: [bad] });

    await expect(wearablesConnectionsApi.list()).rejects.toThrow();
  });

  it('throws (Zod) when provider is not a known enum value', async () => {
    api.get.mockResolvedValueOnce({
      data: [validConnection({ provider: 'NOT_A_PROVIDER' as never })],
    });
    await expect(wearablesConnectionsApi.list()).rejects.toThrow();
  });

  it('throws (Zod) when the payload is not an array', async () => {
    api.get.mockResolvedValueOnce({ data: validConnection() });
    await expect(wearablesConnectionsApi.list()).rejects.toThrow();
  });
});

describe('wearablesConnectionsApi.startOauth', () => {
  it('POSTs /oauth/start with { provider } and parses the result', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        authorizationUrl: 'https://cloud.ouraring.com/oauth/authorize?x=1',
        state: 'state-abc',
      },
    });

    const res = await wearablesConnectionsApi.startOauth('OURA');

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      '/v1/wearables/connections/oauth/start',
      { provider: 'OURA' },
    );
    expect(res.authorizationUrl).toContain('ouraring.com');
    expect(res.state).toBe('state-abc');
  });

  it('rejects on-device providers WITHOUT hitting the network', async () => {
    await expect(wearablesConnectionsApi.startOauth('APPLE_HEALTHKIT')).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('throws (Zod) when authorizationUrl is not a valid URL', async () => {
    api.post.mockResolvedValueOnce({
      data: { authorizationUrl: 'not-a-url', state: 'state-abc' },
    });
    await expect(wearablesConnectionsApi.startOauth('WHOOP')).rejects.toThrow();
  });

  it('throws (Zod) when state is missing', async () => {
    api.post.mockResolvedValueOnce({
      data: { authorizationUrl: 'https://example.com/auth' },
    });
    await expect(wearablesConnectionsApi.startOauth('WHOOP')).rejects.toThrow();
  });
});

describe('wearablesConnectionsApi.disconnect', () => {
  it('DELETEs /v1/wearables/connections/:provider and parses the result', async () => {
    api.delete.mockResolvedValueOnce({
      data: { success: true, provider: 'OURA' },
    });

    const res = await wearablesConnectionsApi.disconnect('OURA');

    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(api.delete).toHaveBeenCalledWith('/v1/wearables/connections/OURA');
    expect(res).toEqual({ success: true, provider: 'OURA' });
  });

  it('throws (Zod) when success is not the literal true', async () => {
    api.delete.mockResolvedValueOnce({
      data: { success: false, provider: 'OURA' },
    });
    await expect(wearablesConnectionsApi.disconnect('OURA')).rejects.toThrow();
  });

  it('throws (Zod) when provider is unknown in the response', async () => {
    api.delete.mockResolvedValueOnce({
      data: { success: true, provider: 'BOGUS' },
    });
    await expect(wearablesConnectionsApi.disconnect('OURA')).rejects.toThrow();
  });
});

describe('provider config + auth-model registry', () => {
  it('has a config entry for every provider in the enum', () => {
    for (const p of WEARABLE_PROVIDERS) {
      const cfg = configFor(p);
      expect(cfg.provider).toBe(p);
      expect(cfg.displayName.length).toBeGreaterThan(0);
      expect(cfg.dataDescription.length).toBeGreaterThan(0);
      expect(cfg.buckets.length).toBeGreaterThan(0);
    }
    expect(Object.keys(PROVIDER_CONFIG)).toHaveLength(WEARABLE_PROVIDERS.length);
  });

  it('classifies the three on-device providers correctly', () => {
    expect(isOnDeviceProvider('APPLE_HEALTHKIT')).toBe(true);
    expect(isOnDeviceProvider('HEALTH_CONNECT')).toBe(true);
    expect(isOnDeviceProvider('SAMSUNG_HEALTH')).toBe(true);
    expect(isOnDeviceProvider('OURA')).toBe(false);
    expect(providerAuthModel('APPLE_HEALTHKIT')).toBe('on-device');
    expect(providerAuthModel('OURA')).toBe('oauth2');
  });
});
