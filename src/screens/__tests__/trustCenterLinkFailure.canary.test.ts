/**
 * Sol B-315-1 canary: a Trust & Privacy link failure report must carry no
 * free-form text from the native exception.
 *
 * This runs the ACTUAL `openTrustCenterLink` operation against the real
 * @sentry/react-native SDK and the app's real `initSentry` /
 * `captureErrorWithoutPii` (only the RNSentry native module is a double, as in
 * src/services/__tests__/sentry.payload.test.ts). `Linking.canOpenURL` and
 * `Linking.openURL` reject with values stuffed with a SYNTHETIC personal-data
 * canary: a person's name, a phone number, an email address, health text, an
 * identifying URL path and query, and an account identifier, in the error's
 * name, message, stack and extra native fields. Every envelope handed to the
 * native transport is decoded and searched for every canary fragment. The
 * positive controls prove the reports were actually sent.
 */
import { Linking, NativeModules } from 'react-native';

const NAME = 'Janet Canaryfield';
const PHONE = '+1 415 555 0142';
const EMAIL = 'janet.canaryfield@example.com';
const HEALTH = 'insulin dependent diabetic, HIV positive';
const PATH_ID = 'patient-janet-canaryfield-0042';
const ACCOUNT = 'acct-canary-7731';
const QUERY = 'session=canarytoken991';
const CANARY_TEXT = `${NAME} ${PHONE} ${EMAIL} ${HEALTH} https://app.trygrowthproject.com/u/${PATH_ID}/privacy?${QUERY}#frag-canary`;
const FRAGMENTS = [
  'Janet',
  'Canaryfield',
  'canaryfield',
  '415 555 0142',
  '4155550142',
  EMAIL,
  'example.com',
  'insulin',
  'diabetic',
  'HIV',
  PATH_ID,
  'canarytoken991',
  'frag-canary',
  ACCOUNT,
];
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
  // The native SDK still holds the signed-in user; the link report must drop it.
  fetchNativeDeviceContexts: { user: { id: ACCOUNT, email: EMAIL } },
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

/** A native-looking rejection with the canary in every text field it has. */
function canaryError(): Error {
  const err = new Error(`Could not open the page for ${CANARY_TEXT}`);
  err.name = `LinkingError ${NAME}`;
  err.stack = `LinkingError ${NAME}: ${CANARY_TEXT}\n    at native (${PATH_ID}.js:1:1)`;
  Object.assign(err, { code: `E_${PHONE}`, userInfo: { note: HEALTH, account: ACCOUNT }, domain: EMAIL, cause: new Error(CANARY_TEXT) });
  return err;
}

describe('Sol B-315-1 canary: no personal data from a native rejection reaches the Sentry report', () => {
  const OLD = process.env.EXPO_PUBLIC_SENTRY_DSN;
  let Sentry: typeof import('@sentry/react-native');
  let openTrustCenterLink: (link: unknown) => Promise<{ cause: string; reference: string | null } | null>;
  let links: Array<{ id: string; url: string }>;
  const references: string[] = [];

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
    Sentry = jest.requireActual('@sentry/react-native');
    const { initSentry, setSentryUser } = jest.requireActual('../../services/sentry');
    initSentry();
    await Sentry.getClient()?.flush(2000);
    setSentryUser({ id: ACCOUNT });
    ({ openTrustCenterLink } = require('../trustCenterLinkFailure'));
    links = require('../trustCenterLinks').trustCenterLinks();

    const canOpen = jest.spyOn(Linking, 'canOpenURL');
    const openUrl = jest.spyOn(Linking, 'openURL');
    try {
      // 1. canOpenURL rejects with an Error (cause "unexpected"), for every link.
      for (const link of links) {
        canOpen.mockRejectedValueOnce(canaryError());
        const failure = await openTrustCenterLink(link);
        expect(failure).toMatchObject({ cause: 'unexpected' });
        references.push(failure!.reference!);
      }
      // 2. canOpenURL rejects with a bare string and with a plain object.
      canOpen.mockRejectedValueOnce(CANARY_TEXT);
      references.push((await openTrustCenterLink(links[0]))!.reference!);
      canOpen.mockRejectedValueOnce({ message: CANARY_TEXT, name: NAME, toString: () => CANARY_TEXT });
      references.push((await openTrustCenterLink(links[1]))!.reference!);
      // 3. openURL rejects (cause "cannot_open").
      canOpen.mockResolvedValue(true);
      openUrl.mockRejectedValueOnce(canaryError());
      const cannot = await openTrustCenterLink(links[0]);
      expect(cannot).toMatchObject({ cause: 'cannot_open' });
      references.push(cannot!.reference!);
    } finally {
      canOpen.mockRestore();
      openUrl.mockRestore();
    }
    await Sentry.getClient()?.flush(2000);
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD;
  });

  it('every failure was actually reported (positive control)', () => {
    const reports = sentEnvelopes().filter((e) => e.includes('TrustCenterLinkError'));
    expect(reports).toHaveLength(links.length + 3);
    for (const ref of references) {
      expect(ref).toMatch(/^[0-9a-f]{8}$/);
      expect(reports.some((e) => e.includes(ref))).toBe(true);
    }
    for (const e of reports) {
      expect(e).toContain('trust_center.link_open_failed');
      expect(e).toContain('"platform":"ios"');
    }
  });

  it('no canary fragment appears anywhere in any envelope sent to the native transport', () => {
    const all = sentEnvelopes().join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const fragment of FRAGMENTS) {
      expect(all).not.toContain(fragment);
    }
  });

  it('each report carries only the closed allowlist of extras', () => {
    const reports = sentEnvelopes().filter((e) => e.includes('TrustCenterLinkError'));
    for (const env of reports) {
      const event = env
        .split('\n')
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .find((o) => o && typeof o === 'object' && 'exception' in o) as { extra?: Record<string, unknown>; user?: unknown } | undefined;
      expect(event).toBeDefined();
      expect(Object.keys(event!.extra ?? {}).sort()).toEqual(
        ['cause', 'error_class', 'event', 'link', 'operation', 'platform', 'reference'],
      );
      expect(event!.user).toBeUndefined();
    }
  });
});
