// Tests for the 401 refresh-cycle interceptor in src/services/api.ts.
//
// Strategy: mock axios.create() so we capture the response-error interceptor
// that api.ts registers. We then invoke that interceptor directly with a fake
// AxiosError to simulate 401s, just like axios would in production.
//
// Why not run real axios HTTP calls? — the interceptor logic is pure
// JavaScript; we don't need a network stack to verify the cycle/attempt math.
// A direct invocation gives us deterministic control over scheduling, which
// matters for the concurrent-401 scenarios.
//
// Why test-only seams in api.ts (`__setRefreshSessionForTests`,
// `__setSignOutForTests`)? — performRefresh and handleRefreshFailure call
// `await import('@supabase/supabase-js')` and `await import('./authActions')`.
// jest's CJS module resolver doesn't intercept dynamic `import()` unless run
// with --experimental-vm-modules, and even then the test runner can tear down
// before the import microtask resolves. The seams short-circuit the dynamic
// import in tests; production still goes through `await import(...)`.

import type { AxiosError, AxiosRequestConfig } from 'axios';

type ResponseErrorHandler = (error: AxiosError) => Promise<unknown>;

jest.mock('axios', () => {
  const instance: {
    request: jest.Mock;
    get: jest.Mock;
    post: jest.Mock;
    put: jest.Mock;
    patch: jest.Mock;
    delete: jest.Mock;
    interceptors: {
      request: { use: jest.Mock };
      response: { use: jest.Mock; handlers: Array<{ fulfilled?: unknown; rejected?: ResponseErrorHandler }> };
    };
    defaults: { headers: { common: Record<string, string> } };
  } = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn(),
        handlers: [],
      },
    },
    defaults: { headers: { common: {} } },
  };
  // Capture the response interceptor so tests can drive it directly.
  instance.interceptors.response.use.mockImplementation((fulfilled, rejected) => {
    instance.interceptors.response.handlers.push({ fulfilled, rejected });
  });
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
    },
    __instance: instance,
  };
});

jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) =>
      k === 'supabase_refresh_token' ? 'fake-refresh-token' : null,
    ),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const axiosMock = jest.requireMock('axios') as {
  __instance: {
    request: jest.Mock;
    interceptors: {
      response: { handlers: Array<{ rejected?: ResponseErrorHandler }> };
    };
  };
};
const secureStorageMock = jest.requireMock('../secureStorage') as {
  secureStorage: { getItem: jest.Mock; setItem: jest.Mock };
};

import {
  __resetRefreshStateForTests,
  __setRefreshSessionForTests,
  __setSignOutForTests,
} from '../api';

function getResponseErrorHandler(): ResponseErrorHandler {
  const handler = axiosMock.__instance.interceptors.response.handlers[0]?.rejected;
  if (!handler) throw new Error('Response interceptor handler not registered');
  return handler;
}

function fake401(config: AxiosRequestConfig = { url: '/whatever' }): AxiosError {
  // Minimal AxiosError shape — the interceptor only reads .response.status,
  // .response.data, .config, and .message.
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed with status code 401',
    config,
    response: {
      status: 401,
      statusText: 'Unauthorized',
      data: {},
      headers: {},
      config,
    },
  } as unknown as AxiosError;
}

describe('api.ts — refresh-cycle race fix', () => {
  let handler: ResponseErrorHandler;
  let refreshSessionMock: jest.Mock;
  let signOutMock: jest.Mock;

  beforeEach(() => {
    __resetRefreshStateForTests();
    axiosMock.__instance.request.mockReset();
    secureStorageMock.secureStorage.getItem.mockClear();
    secureStorageMock.secureStorage.setItem.mockClear();
    // Default refresh session — succeeds with cycle-1 tokens.
    refreshSessionMock = jest.fn(async () => ({
      data: {
        session: {
          access_token: 'token-cycle-1',
          refresh_token: 'refresh-cycle-1',
        },
      },
      error: null,
    }));
    __setRefreshSessionForTests(refreshSessionMock);
    signOutMock = jest.fn(async () => undefined);
    __setSignOutForTests(signOutMock);
    handler = getResponseErrorHandler();
  });

  afterAll(() => {
    __resetRefreshStateForTests();
  });

  it('a) single 401 → one refresh, one retry, success', async () => {
    axiosMock.__instance.request.mockResolvedValueOnce({ status: 200, data: 'ok' });

    const result = await handler(fake401({ url: '/profile' }));

    expect(result).toEqual({ status: 200, data: 'ok' });
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(secureStorageMock.secureStorage.setItem).toHaveBeenCalledWith(
      'supabase_token',
      'token-cycle-1',
    );
    expect(axiosMock.__instance.request).toHaveBeenCalledTimes(1);
    const retried = axiosMock.__instance.request.mock.calls[0][0];
    expect(retried.headers.Authorization).toBe('Bearer token-cycle-1');
  });

  it('b) 5 concurrent 401s → ONE refresh call + 5 successful retries', async () => {
    axiosMock.__instance.request.mockResolvedValue({ status: 200, data: 'ok' });

    const results = await Promise.all([
      handler(fake401({ url: '/r1' })),
      handler(fake401({ url: '/r2' })),
      handler(fake401({ url: '/r3' })),
      handler(fake401({ url: '/r4' })),
      handler(fake401({ url: '/r5' })),
    ]);

    expect(results).toHaveLength(5);
    // Exactly one refresh call covered all five concurrent 401s.
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    // All 5 retries fired.
    expect(axiosMock.__instance.request).toHaveBeenCalledTimes(5);
  });

  it('c) 5 concurrent 401s where retries also 401 → exactly 2 refresh cycles then reject', async () => {
    // Cycle counter for the refresh-session mock.
    let cycle = 0;
    refreshSessionMock.mockImplementation(async () => {
      cycle += 1;
      return {
        data: {
          session: {
            access_token: `token-cycle-${cycle}`,
            refresh_token: `refresh-cycle-${cycle}`,
          },
        },
        error: null,
      };
    });

    // Every retried api.request itself fails with a 401. The interceptor
    // catches that via the mocked request rejecting with an AxiosError,
    // which we feed back through `handler` to model the production loop
    // (in production axios's own response pipeline would re-enter the
    // interceptor; here we drive that explicitly).
    axiosMock.__instance.request.mockImplementation(async (cfg: AxiosRequestConfig) => {
      throw fake401(cfg);
    });

    // Round 1: five concurrent first-time 401s. All coalesce on the first
    // refresh, all retry, all retries fail with another 401.
    const firstRound = await Promise.allSettled([
      handler(fake401({ url: '/r1' })),
      handler(fake401({ url: '/r2' })),
      handler(fake401({ url: '/r3' })),
      handler(fake401({ url: '/r4' })),
      handler(fake401({ url: '/r5' })),
    ]);
    expect(firstRound.every((r) => r.status === 'rejected')).toBe(true);

    // Round 2: feed each failure back through the handler. Configs now carry
    // `_refreshAttempts=1`. Five concurrent 401s coalesce on the SECOND
    // refresh (cycle 2), retries fail again.
    const secondRound = await Promise.allSettled(
      firstRound.map((settled) => {
        if (settled.status !== 'rejected') throw new Error('round 1 should have rejected');
        return handler(settled.reason as AxiosError);
      }),
    );

    // Round 3: configs now have `_refreshAttempts=2 === MAX`, so the
    // interceptor rejects without starting a third refresh.
    const thirdRound = await Promise.allSettled(
      secondRound.map((settled) => {
        if (settled.status !== 'rejected') throw new Error('round 2 should have rejected');
        return handler(settled.reason as AxiosError);
      }),
    );

    expect(thirdRound.every((r) => r.status === 'rejected')).toBe(true);
    // Exactly two refresh cycles — one per round 1 and round 2.
    expect(refreshSessionMock).toHaveBeenCalledTimes(2);
    // signOut MUST NOT fire — refresh itself never failed; we only ran out
    // of per-request attempts.
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('d) bad refresh creds → performRefresh rejects, exactly 1 refresh attempt, signOut once', async () => {
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: new Error('invalid refresh token'),
    });

    const results = await Promise.allSettled([
      handler(fake401({ url: '/r1' })),
      handler(fake401({ url: '/r2' })),
      handler(fake401({ url: '/r3' })),
    ]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    // Exactly one refresh attempt for the whole cascade — no infinite loop.
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    // No access token was ever written.
    const setTokenCalls = secureStorageMock.secureStorage.setItem.mock.calls.filter(
      (c) => c[0] === 'supabase_token',
    );
    expect(setTokenCalls).toHaveLength(0);
    // signOut fires exactly once.
    expect(signOutMock).toHaveBeenCalledTimes(1);
    // No retried request ever fired.
    expect(axiosMock.__instance.request).not.toHaveBeenCalled();
  });

  it('e) loggedOutOnce is bound to refreshPromise lifecycle — second cascade >1s apart still fires signOut once each', async () => {
    refreshSessionMock.mockResolvedValue({
      data: { session: null },
      error: new Error('invalid refresh token'),
    });

    // First cascade — single 401, refresh fails, signOut fires exactly once.
    await Promise.allSettled([handler(fake401({ url: '/a' }))]);
    expect(signOutMock).toHaveBeenCalledTimes(1);

    // Advance fake timers past the old 1-second setTimeout window. The new
    // lifecycle-bound reset already cleared `loggedOutOnce` synchronously in
    // refreshPromise.finally, so this advance is just confirming the fix
    // doesn't regress (the previous setTimeout was the bug, not the
    // assertion).
    jest.useFakeTimers();
    jest.advanceTimersByTime(1500);
    jest.useRealTimers();

    // Second cascade — three concurrent 401s, refresh still fails.
    // Production guarantee: exactly ONE more signOut emission for the whole
    // cascade, not three (the queued requests all reject onto the SAME
    // refreshPromise, which only runs handleRefreshFailure on its catch
    // branch once).
    await Promise.allSettled([
      handler(fake401({ url: '/b1' })),
      handler(fake401({ url: '/b2' })),
      handler(fake401({ url: '/b3' })),
    ]);

    expect(signOutMock).toHaveBeenCalledTimes(2);
  });
});
