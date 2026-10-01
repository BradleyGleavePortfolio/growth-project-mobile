/**
 * Audit #305 A1: every native API request carries the platform, the native
 * build number (from the binary, not the JS bundle) and the purchase policy,
 * so the backend can refuse non-P2P purchase sessions for iOS binaries
 * regardless of which JS bundle is running.
 */
jest.mock('axios', () => {
  const instance = {
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __instance: instance };
});
jest.mock('expo-application', () => ({ nativeBuildVersion: '6' }));
jest.mock('../secureStorage', () => ({ secureStorage: { getItem: jest.fn(() => Promise.resolve(null)) } }));

import { Platform } from 'react-native';

const axiosMock = jest.requireMock('axios') as {
  __instance: { interceptors: { request: { use: jest.Mock } } };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../api');

type Cfg = { headers: Record<string, string> };
const requestInterceptor = axiosMock.__instance.interceptors.request.use.mock.calls[0][0] as (c: Cfg) => Promise<Cfg>;

describe('purchase policy headers', () => {
  const realOS = Platform.OS;
  const g = globalThis as { __DEV__?: boolean };
  const realDev = g.__DEV__;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
    g.__DEV__ = realDev;
  });

  it('iOS release binary build 6: p2p-only, with the native build', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    g.__DEV__ = false;
    const cfg = await requestInterceptor({ headers: {} });
    expect(cfg.headers['X-Client-Platform']).toBe('ios');
    expect(cfg.headers['X-Client-Native-Build']).toBe('6');
    expect(cfg.headers['X-Client-Purchase-Policy']).toBe('p2p-only');
  });

  it('Android: policy all', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    const cfg = await requestInterceptor({ headers: {} });
    expect(cfg.headers['X-Client-Platform']).toBe('android');
    expect(cfg.headers['X-Client-Purchase-Policy']).toBe('all');
  });

  it('web: no custom headers (CORS allow-list unchanged)', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
    const cfg = await requestInterceptor({ headers: {} });
    expect(cfg.headers['X-Client-Platform']).toBeUndefined();
  });
});
