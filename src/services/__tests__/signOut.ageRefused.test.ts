/**
 * FIXAGE2 R5 (owner #C8-UNDER18-B): "a client the age gate refuses can sign
 * out at once, from every place that offers Sign out." Every Sign out in the
 * app calls services/authActions signOut(); this walks each place with the
 * real signOut and the real api response interceptor, against a server that
 * refuses every call for age (403 AGE_CONFIRMATION_REQUIRED, the push-token
 * clear too). Sign-out never waits: a request held from before ends, nothing
 * sign-out sends is held, the age step is not re-opened, and `logout` fires.
 * After it, the next sign-in's refusals are held again as before.
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
  return { __esModule: true, default: { create: jest.fn(() => instance), isAxiosError: () => false }, __instance: instance };
});
jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => 'token-c'),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

const axiosMock: {
  __instance: {
    patch: jest.Mock;
    interceptors: { request: { fulfilled: RequestHandler[] }; response: { rejected: ErrorHandler[] } };
  };
} = jest.requireMock('axios');

import '../api';
import { signOut } from '../authActions';
import { onAgeConfirmationRequired, settleAgeConfirmation } from '../../lib/ageGate';
import { isAccountChangedError } from '../accountBinding';
import { authEvents } from '../../utils/authEvents';

const send = (url: string) => axiosMock.__instance.interceptors.request.fulfilled[0]({ url, headers: {} });
const refuse = async (url: string) => {
  const config = await send(url);
  const err = Object.assign(new Error('Request failed with status code 403'), {
    config,
    response: { status: 403, data: { code: 'AGE_CONFIRMATION_REQUIRED' }, headers: {} },
  });
  return axiosMock.__instance.interceptors.response.rejected[0](err);
};

// Every place that offers Sign out while the age gate can refuse the client
// (each calls signOut(); RootNavigator's lockout and age-step handler is
// signOutFromLockout, which calls signOut()).
const PLACES: Array<[string, () => Promise<void>]> = [
  ['the age step', () => signOut()],
  ['the under-16 stop screen', () => signOut()],
  ['the consultation escape row', () => signOut('client-C')],
  ['Delete account (opened from the age step)', () => signOut()],
  ['a reset-password or invite link opened while signed in', () => signOut()],
  ['client Settings, Profile and wearables', () => signOut()],
  ['the payment lockout', () => signOut()],
];

const heard = jest.fn();
const loggedOut = jest.fn();
let stop: () => void = () => undefined;
beforeEach(() => {
  heard.mockReset();
  loggedOut.mockReset();
  stop = onAgeConfirmationRequired(heard);
  authEvents.on('logout', loggedOut);
  axiosMock.__instance.patch.mockReset();
  axiosMock.__instance.patch.mockImplementation((url: string) => refuse(url));
});
afterEach(() => {
  stop();
  authEvents.off('logout', loggedOut);
  settleAgeConfirmation(false);
});

describe('FIXAGE2 R5: Sign out never waits on the age step', () => {
  it.each(PLACES)('from %s: signs out at once while the server refuses for age', async (_place, run) => {
    const held = refuse('/me/macros/current');
    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(1);
    heard.mockReset();

    await run();

    expect(isAccountChangedError(await held.catch((e: unknown) => e))).toBe(true);
    expect(axiosMock.__instance.patch).toHaveBeenCalledWith('/users/me/push-token', { token: null });
    expect(heard).not.toHaveBeenCalled();
    expect(loggedOut).toHaveBeenCalledTimes(1);

    // The next sign-in: a refusal is held for the age step again.
    let settled = false;
    const next = refuse('/me/macros/current').finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    settleAgeConfirmation(false);
    expect(isAccountChangedError(await next.catch((e: unknown) => e))).toBe(true);
  });
});
