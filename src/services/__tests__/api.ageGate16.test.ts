/**
 * AGEGATE16: the response interceptor reports a 403 AGE_CONFIRMATION_REQUIRED
 * (backend JwtAuthGuard, a client without a 16+ date of birth) so
 * RootNavigator opens the age step, still rejects the request as before,
 * leaves every other 403 alone, and drops a refusal from a retired sign-in
 * (B-352-1). Strategy mirrors api.lockedDunning.test.ts.
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
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __instance: instance };
});
jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => 'token-a1'),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const axiosMock: {
  __instance: {
    interceptors: { request: { fulfilled: RequestHandler[] }; response: { rejected: ErrorHandler[] } };
  };
} = jest.requireMock('axios');

import '../api';
import { dunningLockoutStore } from '../../entitlements/dunning/dunningLockoutStore';
import { onAgeConfirmationRequired } from '../../lib/ageGate';
import { authEvents } from '../../utils/authEvents';

const send = (url = '/me/macros/current') => axiosMock.__instance.interceptors.request.fulfilled[0]({ url, headers: {} });
const onRejected = () => axiosMock.__instance.interceptors.response.rejected[0];
const refusal = (config: Record<string, unknown>, data: Record<string, unknown>) =>
  Object.assign(new Error('Request failed with status code 403'), { config, response: { status: 403, data, headers: {} } });

const heard = jest.fn();
let stop: () => void = () => undefined;
beforeEach(() => {
  dunningLockoutStore.__resetForTests();
  heard.mockReset();
  stop = onAgeConfirmationRequired(heard);
});
afterEach(() => stop());

describe('api response interceptor: AGE_CONFIRMATION_REQUIRED', () => {
  it('reports it once and still rejects the request unchanged', async () => {
    const err = refusal(await send(), { code: 'AGE_CONFIRMATION_REQUIRED', message: 'Age confirmation required' });
    await expect(onRejected()(err)).rejects.toBe(err);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(dunningLockoutStore.isLocked()).toBe(false);
  });

  it('ignores every other 403 and the same code on another status', async () => {
    for (const data of [{ code: 'COACH_ONLY' }, { code: 'LOCKED_DUNNING' }, {}]) {
      const err = refusal(await send(), data);
      await expect(onRejected()(err)).rejects.toBe(err);
    }
    const notForbidden = Object.assign(refusal(await send(), { code: 'AGE_CONFIRMATION_REQUIRED' }), {
      response: { status: 400, data: { code: 'AGE_CONFIRMATION_REQUIRED' }, headers: {} },
    });
    await expect(onRejected()(notForbidden)).rejects.toBe(notForbidden);
    expect(heard).not.toHaveBeenCalled();
  });

  it('a refusal for an account that has since signed out is dropped', async () => {
    const stale = refusal(await send(), { code: 'AGE_CONFIRMATION_REQUIRED' });
    authEvents.emit('logout');
    await expect(onRejected()(stale)).rejects.toBe(stale);
    expect(heard).not.toHaveBeenCalled();
  });
});
