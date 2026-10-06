/**
 * S-DUNNING: the response interceptor turns a 403 LOCKED_DUNNING into the
 * app-wide lockout signal (with the backend request id) and a specific
 * message, and leaves every other 403 alone. Strategy mirrors
 * api.correlation.test.ts: axios.create() is mocked so the registered
 * interceptors can be invoked directly.
 *
 * B-352-1: the signal is owned by the auth generation the request started
 * under. Sign-out retires it, and a late 403 for the previous account never
 * locks the next one; a same-account token refresh keeps working.
 */
type ErrorHandler = (error: unknown) => Promise<unknown>;
type RequestHandler = (config: Record<string, unknown>) => Promise<Record<string, unknown>>;

jest.mock('axios', () => {
  const instance = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), fulfilled: [] as RequestHandler[] },
      response: { use: jest.fn(), rejected: [] as ErrorHandler[] },
    },
    defaults: { headers: { common: {} as Record<string, string> } },
  };
  instance.interceptors.request.use.mockImplementation((fulfilled: RequestHandler) => {
    instance.interceptors.request.fulfilled.push(fulfilled);
  });
  instance.interceptors.response.use.mockImplementation((_ok: unknown, rejected: ErrorHandler) => {
    instance.interceptors.response.rejected.push(rejected);
  });
  return {
    __esModule: true,
    default: { create: jest.fn(() => instance) },
    __instance: instance,
  };
});

let mockToken: string | null = null;
jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => mockToken),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const axiosMock: {
  __instance: {
    interceptors: { request: { fulfilled: RequestHandler[] }; response: { rejected: ErrorHandler[] } };
  };
} = jest.requireMock('axios');

import { LOCKED_DUNNING_MESSAGE } from '../api';
import { dunningLockoutStore } from '../../entitlements/dunning/dunningLockoutStore';
import { authEvents } from '../../utils/authEvents';

/** Run the registered request interceptor, as axios does before sending. */
async function send(url = '/v1/workouts/today'): Promise<Record<string, unknown>> {
  const handler = axiosMock.__instance.interceptors.request.fulfilled[0];
  if (!handler) throw new Error('Request interceptor not registered');
  return handler({ url, headers: {} });
}

/** The 403 LOCKED_DUNNING answer to a request that went through `send`. */
function lockedAnswerTo(config: Record<string, unknown>) {
  return Object.assign(new Error('Request failed with status code 403'), {
    config,
    response: { status: 403, data: { code: 'LOCKED_DUNNING' }, headers: { 'x-request-id': 'req-old' } },
  });
}

function onRejected(): ErrorHandler {
  const handler = axiosMock.__instance.interceptors.response.rejected[0];
  if (!handler) throw new Error('Response interceptor not registered');
  return handler;
}

function forbidden(data: Record<string, unknown>) {
  return Object.assign(new Error('Request failed with status code 403'), {
    config: { url: '/v1/workouts/today', headers: {} },
    response: { status: 403, data, headers: { 'x-request-id': 'req-lock-1' } },
  });
}

beforeEach(() => {
  dunningLockoutStore.__resetForTests();
  mockToken = 'token-a1';
});

describe('api response interceptor: LOCKED_DUNNING', () => {
  it('reports the lockout with the request id and sets a specific message', async () => {
    const err = forbidden({ code: 'LOCKED_DUNNING', message: 'Your account is locked.' });
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(dunningLockoutStore.isLocked()).toBe(true);
    expect(dunningLockoutStore.lastSignal()).toEqual({
      requestId: 'req-lock-1',
      requestUrl: '/v1/workouts/today',
    });
    expect(err.message).toBe(LOCKED_DUNNING_MESSAGE);
  });

  it('C-352-4: the message is true for a reversed-payment lock too (no card promise)', () => {
    expect(LOCKED_DUNNING_MESSAGE).toContain('Your plan is paused');
    expect(LOCKED_DUNNING_MESSAGE).not.toMatch(/update your card|has not gone through/i);
    expect(LOCKED_DUNNING_MESSAGE).not.toMatch(/\b(we|our|us)\b|!/i);
  });

  it('ignores every other 403', async () => {
    const err = forbidden({ code: 'COACH_ONLY', message: 'Coaches only.' });
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(dunningLockoutStore.isLocked()).toBe(false);
    expect(err.message).toBe('Request failed with status code 403');
  });
});

describe('B-352-1: the lockout signal belongs to one auth generation', () => {
  it('sign-out retires the signal and its request reference synchronously', async () => {
    const err = lockedAnswerTo(await send());
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(dunningLockoutStore.isLocked()).toBe(true);
    authEvents.emit('logout');
    expect(dunningLockoutStore.isLocked()).toBe(false);
    expect(dunningLockoutStore.lastSignal()).toBeNull();
  });

  it('a late 403 for account A, answered after A signed out and B signed in, does not lock B', async () => {
    const stale = lockedAnswerTo(await send());
    authEvents.emit('logout');
    mockToken = 'token-b1';
    authEvents.emit('login');
    dunningLockoutStore.clear();
    await expect(onRejected()(stale)).rejects.toBe(stale);
    expect(dunningLockoutStore.isLocked()).toBe(false);
    expect(dunningLockoutStore.lastSignal()).toBeNull();
    // B's own lockout still works.
    const current = lockedAnswerTo(await send());
    await expect(onRejected()(current)).rejects.toBe(current);
    expect(dunningLockoutStore.isLocked()).toBe(true);
  });

  it('a same-account token refresh between request and answer still locks (no identity change)', async () => {
    const config = await send();
    expect((config.headers as Record<string, string>).Authorization).toBe('Bearer token-a1');
    mockToken = 'token-a2';
    const err = lockedAnswerTo(config);
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(dunningLockoutStore.isLocked()).toBe(true);
    expect(dunningLockoutStore.lastSignal()?.requestId).toBe('req-old');
  });

  it('an unstamped 403 after an identity boundary is dropped (fail closed)', async () => {
    authEvents.emit('logout');
    const err = forbidden({ code: 'LOCKED_DUNNING' });
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(dunningLockoutStore.isLocked()).toBe(false);
    expect(err.message).toBe(LOCKED_DUNNING_MESSAGE);
  });
});
