/**
 * S-DUNNING: the response interceptor turns a 403 LOCKED_DUNNING into the
 * app-wide lockout signal (with the backend request id) and a specific
 * message, and leaves every other 403 alone. Strategy mirrors
 * api.correlation.test.ts: axios.create() is mocked so the registered
 * interceptor can be invoked directly.
 */
type ErrorHandler = (error: unknown) => Promise<unknown>;

jest.mock('axios', () => {
  const instance = {
    request: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn(), rejected: [] as ErrorHandler[] },
    },
    defaults: { headers: { common: {} as Record<string, string> } },
  };
  instance.interceptors.response.use.mockImplementation((_ok: unknown, rejected: ErrorHandler) => {
    instance.interceptors.response.rejected.push(rejected);
  });
  return {
    __esModule: true,
    default: { create: jest.fn(() => instance) },
    __instance: instance,
  };
});

jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const axiosMock: {
  __instance: { interceptors: { response: { rejected: ErrorHandler[] } } };
} = jest.requireMock('axios');

import '../api';
import { dunningLockoutStore } from '../../entitlements/dunning/dunningLockoutStore';

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

beforeEach(() => dunningLockoutStore.__resetForTests());

describe('api response interceptor: LOCKED_DUNNING', () => {
  it('reports the lockout with the request id and sets a specific message', async () => {
    const err = forbidden({ code: 'LOCKED_DUNNING', message: 'Your account is locked.' });
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(dunningLockoutStore.isLocked()).toBe(true);
    expect(dunningLockoutStore.lastSignal()).toEqual({
      requestId: 'req-lock-1',
      requestUrl: '/v1/workouts/today',
    });
    expect(err.message).toBe(
      'Your plan is paused because a payment has not gone through. Update your card to restore access.',
    );
  });

  it('ignores every other 403', async () => {
    const err = forbidden({ code: 'COACH_ONLY', message: 'Coaches only.' });
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(dunningLockoutStore.isLocked()).toBe(false);
    expect(err.message).toBe('Request failed with status code 403');
  });
});
