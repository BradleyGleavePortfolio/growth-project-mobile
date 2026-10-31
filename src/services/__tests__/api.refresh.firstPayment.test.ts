/**
 * FR-898R3 (B-LS898R3-1, second entry): when a failed token refresh ends in
 * the server's deletion receipt ("deleted"), the sign-out that follows must
 * remove the deleted coach's first-payment shown mark from this phone. When
 * the receipt says nothing was deleted (404 NO_DELETION_RECEIPT), it is an
 * ordinary sign-out and every coach's mark stays.
 *
 * Real api.ts refresh interceptor, real authActions.signOut (passed through
 * the `__setSignOutForTests` seam because jest cannot follow the dynamic
 * import), real firstPaymentGate and AsyncStorage. Only the network (axios),
 * secure storage and a few native services are mocked.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AxiosError, AxiosRequestConfig } from 'axios';

type ResponseErrorHandler = (error: AxiosError) => Promise<unknown>;

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
      response: {
        use: jest.fn(),
        handlers: [] as Array<{ rejected?: ResponseErrorHandler }>,
      },
    },
    defaults: { headers: { common: {} } },
  };
  instance.interceptors.response.use.mockImplementation((fulfilled, rejected) => {
    instance.interceptors.response.handlers.push({ rejected });
  });
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __instance: instance };
});
jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) =>
      k === 'supabase_token' ? 'stale-access-token' : k === 'supabase_refresh_token' ? 'r' : null,
    ),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../realtime', () => ({ refreshRealtimeAuth: jest.fn() }));
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'coach-deleted' }),
  readUserCache: async () => ({ id: 'coach-deleted' }),
  clearUserCache: async () => undefined,
}));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../offline/sync/sync-engine', () => ({
  countQueuedWorkouts: jest.fn(async () => 0),
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));

import { Alert } from 'react-native';
import {
  DELETION_COMPLETE_NOTICE,
  __resetRefreshStateForTests,
  __setRefreshSessionForTests,
  __setSignOutForTests,
} from '../api';
import { signOut } from '../authActions';
import { authEvents } from '../../utils/authEvents';
import { hasSeenFirstPayment, markFirstPaymentSeen } from '../../screens/coach/ed/firstPaymentGate';

const axiosMock = jest.requireMock('axios') as {
  __instance: {
    post: jest.Mock;
    request: jest.Mock;
    interceptors: { response: { handlers: Array<{ rejected?: ResponseErrorHandler }> } };
  };
};

function fake401(): AxiosError {
  const config: AxiosRequestConfig = { url: '/whatever' };
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Request failed with status code 401',
    config,
    response: { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config },
  } as unknown as AxiosError;
}

describe('refresh failure with a deletion receipt and the first-payment shown mark', () => {
  let alertSpy: jest.SpyInstance;
  let loggedOut: jest.Mock;

  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetRefreshStateForTests();
    __setRefreshSessionForTests(
      jest.fn(async () => ({
        data: { session: null },
        error: new Error('User from sub claim in JWT does not exist'),
      })),
    );
    __setSignOutForTests(signOut);
    axiosMock.__instance.post.mockReset();
    axiosMock.__instance.request.mockReset();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    loggedOut = jest.fn();
    authEvents.on('logout', loggedOut);
    await markFirstPaymentSeen('coach-deleted');
    await markFirstPaymentSeen('coach-other');
    await AsyncStorage.setItem('pending_invite_code', 'private');
  });

  afterEach(() => {
    authEvents.off('logout', loggedOut);
    alertSpy.mockRestore();
  });

  afterAll(() => {
    __resetRefreshStateForTests();
  });

  function handler(): ResponseErrorHandler {
    const h = axiosMock.__instance.interceptors.response.handlers[0]?.rejected;
    if (!h) throw new Error('Response interceptor handler not registered');
    return h;
  }

  it('control: no deletion receipt (404) is an ordinary sign-out and keeps every coach mark', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      response: { status: 404, data: { code: 'NO_DELETION_RECEIPT' } },
    });
    await handler()(fake401()).catch(() => undefined);
    expect(loggedOut).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    // The real sign-out ran.
    expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
    expect(await hasSeenFirstPayment('coach-deleted')).toBe(true);
    expect(await hasSeenFirstPayment('coach-other')).toBe(true);
  });

  it('B-LS898R3-1 (refresh entry): a confirmed deletion receipt removes only the deleted coach mark', async () => {
    axiosMock.__instance.post.mockResolvedValue({ data: { state: 'deleted' } });
    await handler()(fake401()).catch(() => undefined);
    expect(axiosMock.__instance.post).toHaveBeenCalledWith(
      '/account-deletion/receipt',
      undefined,
      expect.objectContaining({ skipAuthRefresh: true }),
    );
    expect(loggedOut).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(DELETION_COMPLETE_NOTICE.title, DELETION_COMPLETE_NOTICE.body);
    expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
    expect(await AsyncStorage.getItem('roman.ed3.first-payment-seen.coach-deleted')).toBeNull();
    expect(await AsyncStorage.getItem('roman.ed3.first-payment-seen.coach-other')).toBe('true');
  });
});
