/**
 * B-330-3: end-to-end payload proof with the real @sentry/react-native 7.11
 * SDK (only the RNSentry native module is a double). It checks what actually
 * leaves the app: the envelope handed to native transport, the breadcrumbs
 * scope sync copies to native (they ride along in native crash reports), and
 * the options dictionary the native SDKs are re-initialized with.
 */
import { NativeModules } from 'react-native';

const CANARY = 'AUDIT_SYNTHETIC_PRIVATE_MESSAGE';
const EMAIL = 'person.canary@example.com';
const DSN = 'https://abc@o1.ingest.sentry.io/1';

type Call = unknown[];
const calls: Record<string, Call[]> = {};
const nativeResult: Record<string, unknown> = {
  initNativeSdk: true,
  captureEnvelope: true,
  crashedLastRun: false,
  fetchNativeRelease: { id: 'com.tgp', version: '1.0.0', build: '6' },
  fetchNativeSdkInfo: { name: 'sentry.cocoa', version: '8.58.0' },
  fetchModules: null,
  fetchNativeAppStart: null,
  fetchNativeFrames: null,
  fetchNativeLogAttributes: null,
  fetchNativeStackFramesBy: null,
  fetchViewHierarchy: null,
  captureScreenshot: null,
  getCurrentReplayId: null,
  getNewScreenTimeToDisplay: null,
  getDataFromUri: null,
  encodeToBase64: null,
  fetchNativeDeviceContexts: {
    // What the native SDK holds: an iOS NSURLSession breadcrumb with a query
    // and a native user that still has an email.
    breadcrumbs: [
      {
        type: 'http',
        category: 'http',
        level: 'info',
        timestamp: 1,
        data: { method: 'GET', url: `https://api.example.test/api/messages/search?q=${CANARY}`, status_code: 200 },
      },
    ],
    user: { id: 'acct-1', email: EMAIL },
  },
};
const rnSentry = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === 'then' || prop === '$$typeof') return undefined;
      return (...args: unknown[]) => {
        (calls[prop] = calls[prop] || []).push(args);
        return prop in nativeResult ? Promise.resolve(nativeResult[prop]) : undefined;
      };
    },
  },
);
Object.defineProperty(NativeModules, 'RNSentry', { value: rnSentry, configurable: true });

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', ios: { buildNumber: '6' }, android: { versionCode: 4 }, extra: {} } },
}));

function sentEnvelopes(): string[] {
  return (calls.captureEnvelope || []).map((args) => Buffer.from(String(args[0]), 'base64').toString('utf8'));
}

describe('real SDK: what leaves the app', () => {
  const OLD = process.env.EXPO_PUBLIC_SENTRY_DSN;
  let Sentry: typeof import('@sentry/react-native');

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
    Sentry = jest.requireActual('@sentry/react-native');
    const { initSentry, setSentryUser } = jest.requireActual('../sentry');
    initSentry();
    await Sentry.getClient()?.flush(2000);
    setSentryUser({ id: 'acct-1', email: EMAIL });
    Sentry.addBreadcrumb({ category: 'xhr', type: 'http', data: { method: 'GET', url: `https://api.example.test/api/search?q=${CANARY}#${CANARY}`, status_code: 200 } });
    Sentry.addBreadcrumb({ category: 'fetch', type: 'http', data: { method: 'POST', url: `https://api.example.test/api/messages/${CANARY}`, status_code: 201, request_body: CANARY } });
    Sentry.addBreadcrumb({ category: 'console', level: 'log', message: `draft: ${CANARY}` });
    Sentry.addBreadcrumb({ category: 'app.custom', message: `note ${CANARY}`, data: { text: CANARY, state: 'active' } });
    Sentry.captureException(new Error('synthetic failure'));
    await Sentry.getClient()?.flush(2000);
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD;
  });

  it('the native SDK is re-initialized with every privacy flag, including the native-only network keys', () => {
    expect(calls.initNativeSdk).toHaveLength(1);
    const nativeOptions: unknown = calls.initNativeSdk[0][0];
    expect(nativeOptions).toMatchObject({
      dsn: DSN,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      enableNetworkBreadcrumbs: false,
      enableNetworkTracking: false,
    });
    // The JS callbacks never cross the bridge, so native relies on these keys.
    expect(nativeOptions).not.toHaveProperty('beforeBreadcrumb');
    expect(nativeOptions).not.toHaveProperty('beforeSend');
  });

  it('the error envelope carries no canary, no email, and no console or free-text breadcrumb', () => {
    const envelopes = sentEnvelopes().filter((e) => e.includes('synthetic failure'));
    expect(envelopes).toHaveLength(1);
    const env = envelopes[0];
    expect(env).not.toContain(CANARY);
    expect(env).not.toContain(EMAIL);
    expect(env).not.toContain('draft:');
    // Positive controls: the breadcrumbs are kept in route form, the user by id.
    expect(env).toContain('https://api.example.test/api/search');
    expect(env).toContain('https://api.example.test/api/messages/:id');
    expect(env).toContain('https://api.example.test/api/messages/search');
    expect(env).toContain('"id":"acct-1"');
  });

  it('scope sync hands native only scrubbed breadcrumbs and the id-only user (native crash reports)', () => {
    const toNative = JSON.stringify(calls.addBreadcrumb || []);
    expect((calls.addBreadcrumb || []).length).toBeGreaterThanOrEqual(3);
    expect(toNative).not.toContain(CANARY);
    expect(toNative).not.toContain('draft:');
    expect(toNative).toContain('https://api.example.test/api/search');
    const users = JSON.stringify(calls.setUser || []);
    expect(users).toContain('acct-1');
    expect(users).not.toContain(EMAIL);
  });
});
