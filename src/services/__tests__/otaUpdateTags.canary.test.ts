/**
 * Sol B-305-10 canary: the OTA emergency-launch report must carry no
 * free-form native text. This runs the ACTUAL `reportOtaUpdateLaunch` against
 * the real @sentry/react-native SDK initialised by the app's real
 * `initSentry` (only the RNSentry native module is a double, as in
 * src/services/__tests__/sentry.payload.test.ts). The native ExpoUpdates
 * constants carry a SYNTHETIC personal-data canary (name, email, phone,
 * identifier, health text) in `emergencyLaunchReason` and in every other
 * string field. Every envelope handed to the native transport is decoded and
 * searched; positive controls prove the warning was sent.
 */
import { NativeModules } from 'react-native';

const NAME = 'Janet Canaryfield';
const EMAIL = 'janet.canaryfield@example.com';
const PHONE = '+1 415 555 0142';
const IDENT = 'patient-canary-7731';
const HEALTH = 'insulin dependent diabetic, HIV positive';
const CANARY_TEXT = `${NAME} ${EMAIL} ${PHONE} ${IDENT} ${HEALTH}`;
const FRAGMENTS = ['Janet', 'Canaryfield', 'canaryfield', EMAIL, 'example.com', '415 555 0142', IDENT, '7731', 'insulin', 'diabetic', 'HIV'];
const DSN = 'https://abc@o1.ingest.sentry.io/1';
const RUNTIME = '0123456789abcdef0123456789abcdef01234567';
const ACCOUNT = 'acct-ota-1';

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
  fetchNativeDeviceContexts: {},
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

describe('Sol B-305-10 canary: no native free-form text reaches the OTA emergency report', () => {
  const OLD = process.env.EXPO_PUBLIC_SENTRY_DSN;

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
    const Sentry: typeof import('@sentry/react-native') = jest.requireActual('@sentry/react-native');
    const { initSentry, setSentryUser } = jest.requireActual('../sentry');
    initSentry();
    await Sentry.getClient()?.flush(2000);
    setSentryUser({ id: ACCOUNT });
    const { reportOtaUpdateLaunch, resetOtaUpdateReportForTests } = jest.requireActual('../otaUpdateTags');
    resetOtaUpdateReportForTests();
    const root = {
      expo: {
        modules: {
          ExpoUpdates: {
            isEnabled: true,
            updateId: 'abcdef00-1111-2222-3333-444455556666',
            channel: 'clinic',
            runtimeVersion: RUNTIME,
            isEmbeddedLaunch: true,
            isEmergencyLaunch: true,
            emergencyLaunchReason: `Failed to launch the update for ${CANARY_TEXT} at /var/mobile/${IDENT}/a.hbc`,
          },
        },
      },
    };
    reportOtaUpdateLaunch(Sentry, root);
    // A second pass with the canary in the identifier fields as well.
    resetOtaUpdateReportForTests();
    reportOtaUpdateLaunch(Sentry, {
      expo: {
        modules: {
          ExpoUpdates: {
            ...root.expo.modules.ExpoUpdates,
            updateId: `${CANARY_TEXT}`,
            channel: `clinic ${EMAIL}`,
            runtimeVersion: `${RUNTIME} ${PHONE}`,
            emergencyLaunchReason: CANARY_TEXT,
          },
        },
      },
    });
    await Sentry.getClient()?.flush(2000);
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD;
  });

  it('the emergency warning was sent with the closed category and the searchable tags (positive control)', () => {
    const reports = sentEnvelopes().filter((e) => e.includes('OTA emergency launch'));
    expect(reports).toHaveLength(2);
    expect(reports[0]).toContain('"reason_category":"asset_or_bundle"');
    expect(reports[0]).toContain('abcdef00-1111-2222-3333-444455556666');
    expect(reports[0]).toContain(RUNTIME);
    expect(reports[1]).toContain('"reason_category":"unknown"');
    expect(reports[1]).toContain('"expo.updates.channel":"other"');
  });

  it('no canary fragment appears anywhere in any envelope sent to the native transport', () => {
    const all = sentEnvelopes().join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const fragment of FRAGMENTS) {
      expect(all).not.toContain(fragment);
    }
  });

  it('the ota_emergency context holds only the reason category', () => {
    for (const env of sentEnvelopes().filter((e) => e.includes('OTA emergency launch'))) {
      const event = env
        .split('\n')
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .find((o) => o && typeof o === 'object' && 'contexts' in o) as { contexts?: Record<string, Record<string, unknown>> } | undefined;
      expect(Object.keys(event?.contexts?.ota_emergency ?? {})).toEqual(['reason_category']);
    }
  });
});
