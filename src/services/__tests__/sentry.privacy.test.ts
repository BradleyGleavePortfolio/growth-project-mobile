/**
 * src/services/sentry.ts sends no PII: the JS init (which re-initializes the
 * native SDK started by plugins/withSentryNativeInit.js) keeps default PII,
 * screenshots, view hierarchy and failed-request events off, and the user
 * binding carries the account id only.
 */
const mockInit = jest.fn();
const mockSetUser = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: (...a: unknown[]) => mockInit(...a),
  setUser: (...a: unknown[]) => mockSetUser(...a),
  wrap: (c: unknown) => c,
  withScope: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '6' }, android: { versionCode: 4 }, extra: {} } },
}));

describe('sentry service privacy', () => {
  const OLD = process.env.EXPO_PUBLIC_SENTRY_DSN;
  beforeEach(() => {
    jest.resetModules();
    mockInit.mockClear();
    mockSetUser.mockClear();
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD;
  });

  it('initializes with every PII-bearing capture off', () => {
    jest.isolateModules(() => {
      const { initSentry } = require('../sentry');
      initSentry();
    });
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0][0]).toMatchObject({
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      enableNative: true,
    });
  });

  it('binds the user by id only, even when the caller object carries an email', () => {
    jest.isolateModules(() => {
      const { initSentry, setSentryUser } = require('../sentry');
      initSentry();
      const signedIn = { id: 'user-1', email: 'person@example.com' };
      setSentryUser(signedIn);
      setSentryUser(null);
    });
    expect(mockSetUser).toHaveBeenNthCalledWith(1, { id: 'user-1' });
    expect(mockSetUser).toHaveBeenNthCalledWith(2, null);
  });
});
