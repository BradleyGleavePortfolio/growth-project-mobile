// SESSION-KEEP-130 (EXPLORE-CLIENT-129 B1): a session renewal that gets no
// answer (signal lost, timeout, sign-in service busy or down) must never sign
// the client out: sign-out deletes the workouts and foods still waiting on the
// phone. Only a renewal the sign-in service refuses signs out.
//
// Same harness as api.refresh.test.ts: axios.create() is mocked so the
// response interceptor api.ts registers can be driven directly with a 401.
// The refresh errors are the real supabase-js classes refreshSession returns.

import type { AxiosRequestConfig } from 'axios';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

// Structural stand-ins: the interceptor reads only these fields.
type Fake401 = {
  isAxiosError: true;
  name: string;
  message: string;
  config: AxiosRequestConfig;
  status: number;
  response: { status: number; statusText: string; data: object; headers: object; config: AxiosRequestConfig };
};
type Failure = { response?: unknown; code?: string; message?: string; status?: number };
type ResponseErrorHandler = (error: Fake401) => Promise<unknown>;

jest.mock('axios', () => {
  const handlers: Array<{ rejected?: unknown }> = [];
  const instance = {
    request: jest.fn(),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: {
        handlers,
        use: jest.fn((_fulfilled: unknown, rejected: unknown) => handlers.push({ rejected })),
      },
    },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __instance: instance };
});

jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => (k === 'supabase_refresh_token' ? 'refresh-1' : 'access-1')),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const axiosMock = jest.requireMock<{
  __instance: {
    request: jest.Mock;
    interceptors: { response: { handlers: Array<{ rejected?: ResponseErrorHandler }> } };
  };
}>('axios');

import {
  __resetRefreshStateForTests,
  __setRefreshSessionForTests,
  __setSignOutForTests,
} from '../api';

function fake401(config: AxiosRequestConfig = { url: '/log/food' }): Fake401 {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed with status code 401',
    config,
    status: 401,
    response: { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config },
  };
}

const NO_SESSION = { data: { session: null } };
const RENEWED = {
  data: { session: { access_token: 'access-2', refresh_token: 'refresh-2' } },
  error: null,
};

describe('session renewal without signal (SESSION-KEEP-130)', () => {
  let handler: ResponseErrorHandler;
  let refreshSession: jest.Mock;
  let signOut: jest.Mock;

  beforeEach(() => {
    __resetRefreshStateForTests();
    axiosMock.__instance.request.mockReset();
    refreshSession = jest.fn();
    __setRefreshSessionForTests(refreshSession);
    signOut = jest.fn(async () => undefined);
    __setSignOutForTests(signOut);
    const rejected = axiosMock.__instance.interceptors.response.handlers[0]?.rejected;
    if (!rejected) throw new Error('response interceptor not registered');
    handler = rejected;
  });

  afterAll(() => __resetRefreshStateForTests());

  it('no signal during renewal: nobody is signed out, the request fails as "no connection", the next 401 renews', async () => {
    refreshSession.mockResolvedValueOnce({
      ...NO_SESSION,
      error: new AuthRetryableFetchError('Network request failed', 0),
    });

    const failure = (await handler(fake401()).catch((e: unknown) => e)) as Failure;

    expect(signOut).not.toHaveBeenCalled();
    // Shaped like a request that got no answer, so the food queue and the
    // workout sync keep their rows and screens say there is no connection.
    expect(failure.response).toBeUndefined();
    expect(failure.status).toBeUndefined();
    expect(failure.code).toBe('ERR_NETWORK');
    expect(failure.message).toBe('Cannot reach server. Please check your connection and try again.');
    expect(axiosMock.__instance.request).not.toHaveBeenCalled();

    // Signal back: the next 401 renews with the kept refresh token and replays.
    refreshSession.mockResolvedValueOnce(RENEWED);
    axiosMock.__instance.request.mockResolvedValueOnce({ status: 201, data: { id: 'log-1' } });
    await expect(handler(fake401())).resolves.toEqual({ status: 201, data: { id: 'log-1' } });
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenLastCalledWith({ refresh_token: 'refresh-1' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('concurrent 401s share one renewal; none of them signs out when it gets no answer', async () => {
    refreshSession.mockResolvedValue({
      ...NO_SESSION,
      error: new AuthRetryableFetchError('Network request failed', 0),
    });

    const results = await Promise.allSettled([
      handler(fake401({ url: '/a' })),
      handler(fake401({ url: '/b' })),
      handler(fake401({ url: '/c' })),
    ]);

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason.code).toBe('ERR_NETWORK');
    }
    expect(signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['a gateway timeout', () => new AuthRetryableFetchError('Gateway Timeout', 504)],
    ['a sign-in service error', () => new AuthApiError('Internal Server Error', 500, 'unexpected_failure')],
    ['sign-in service rate limiting', () => new AuthApiError('Too many requests', 429, 'over_request_rate_limit')],
  ])('%s during renewal keeps the session', async (_label, makeError) => {
    refreshSession.mockResolvedValueOnce({ ...NO_SESSION, error: makeError() });

    const failure = (await handler(fake401()).catch((e: unknown) => e)) as Failure;

    expect(failure.code).toBe('ERR_NETWORK');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('a refused renewal (invalid or revoked sign-in) still signs out once', async () => {
    const refused = new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found');
    refreshSession.mockResolvedValue({ ...NO_SESSION, error: refused });

    const results = await Promise.allSettled([handler(fake401({ url: '/a' })), handler(fake401({ url: '/b' }))]);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(results.map((r) => (r as PromiseRejectedResult).reason)).toEqual([refused, refused]);
  });

  it('a replay that itself gets a 503 is passed on as it came, not turned into "no connection"', async () => {
    refreshSession.mockResolvedValueOnce(RENEWED);
    const replayFailure = { isAxiosError: true, status: 503, response: { status: 503, data: {} } };
    axiosMock.__instance.request.mockRejectedValueOnce(replayFailure);

    await expect(handler(fake401())).rejects.toBe(replayFailure);
    expect(signOut).not.toHaveBeenCalled();
  });
});
