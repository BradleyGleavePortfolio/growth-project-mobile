/**
 * TOKEN-CACHE-M, second guard: the shared axios instance (services/api.ts) redacts the
 * Authorization header in an AxiosError's JSON, so no JSON.stringify of a
 * failed request (the query cache, a log line) can write the sign-in token.
 *
 * REAL axios instance with its request and response interceptors. Only
 * SecureStore and the transport adapter are doubled: the adapter records the
 * header that would have been sent and never touches the network. The token
 * is a fake test value.
 */
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';

jest.mock('../secureStorage', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    secureStorage: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
    },
  };
});

import api, { __resetRefreshStateForTests, __setSignOutForTests } from '../api';

const secure = jest.requireMock('../secureStorage') as { __store: Map<string, string> };
const TOKEN = 'FAKE.TEST.TOKEN';

let sentAuthorization: unknown;
const adapter: AxiosAdapter = (config) => {
  sentAuthorization = config.headers?.Authorization;
  const response: AxiosResponse = { data: { code: 'not_found' }, status: 404, statusText: '', headers: {}, config };
  return Promise.reject(
    new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST', config, {}, response),
  );
};

beforeEach(() => {
  __resetRefreshStateForTests();
  __setSignOutForTests(async () => undefined);
  api.defaults.adapter = adapter;
  sentAuthorization = undefined;
  secure.__store.clear();
  secure.__store.set('supabase_token', TOKEN);
});

describe('second guard: the shared axios instance redacts Authorization in error JSON', () => {
  it.each([
    ['a plain call', () => api.get('/v1/community/notes/n1')],
    ['a call with its own config', () => api.put('/v1/community/notes/n1', { a: 1 }, { headers: { 'X-Test': '1' }, timeout: 5000 })],
  ])('%s', async (_label, send) => {
    const err = await send().catch((e: unknown) => e);

    expect(axios.isAxiosError(err)).toBe(true);
    // The request itself is unchanged: it went out with the token.
    expect(sentAuthorization).toBe(`Bearer ${TOKEN}`);
    // The live error the app reads is unchanged too.
    expect((err as AxiosError).config?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect((err as AxiosError).response?.status).toBe(404);

    const json = JSON.stringify(err);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain('Bearer');
    const saved = JSON.parse(json);
    expect(saved.config.headers.Authorization).toMatch(/REDACTED/);
    expect(saved.status).toBe(404);
  });
});
