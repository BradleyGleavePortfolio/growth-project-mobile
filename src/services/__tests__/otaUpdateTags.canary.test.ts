/**
 * Privacy canary for over-the-air update diagnostics (Sol B-305-10, Opus and
 * Sol B-305-12, builder B-305-11).
 *
 * This runs the app's ACTUAL Sentry setup end to end: the real
 * @sentry/react-native SDK initialised by the real `initSentry`, then an
 * ordinary `captureError` and the real `reportOtaUpdateLaunch()` with its
 * default arguments. Only the RNSentry native module is a double (as in
 * src/services/__tests__/sentry.payload.test.ts), and it records every call,
 * so both exits are searched: the envelopes handed to the native transport
 * (JS events) and every other native call, NATIVE.setContext above all (the
 * native crash scope, which no JS beforeSend can reach).
 *
 * The native ExpoUpdates constants are installed on the REAL global the SDK
 * reads (`globalThis.expo.modules.ExpoUpdates`) BEFORE initSentry, carrying a
 * SYNTHETIC personal-data canary (name, email, phone, identifier, health
 * text) in `emergencyLaunchReason` and, in a second pass, in every string
 * field. Positive controls prove the bounded context, the tags and the
 * warning were sent. The previous global value is restored afterwards.
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
const UPDATE_ID = 'abcdef00-1111-2222-3333-444455556666';
const ACCOUNT = 'acct-ota-1';
const ORDINARY = 'ordinary failure E_OTA_CANARY';

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

/** The native ExpoUpdates constants of an emergency launch, with the canary in the reason. */
const NATIVE_UPDATES: Record<string, unknown> = {
  isEnabled: true,
  updateId: UPDATE_ID.toUpperCase(),
  channel: 'clinic',
  runtimeVersion: RUNTIME,
  checkAutomatically: 'ON_LOAD',
  isEmbeddedLaunch: true,
  isEmergencyLaunch: true,
  isUsingEmbeddedAssets: true,
  launchDuration: 412,
  emergencyLaunchReason: `Failed to launch the update for ${CANARY_TEXT} at /var/mobile/${IDENT}/a.hbc`,
};

type ExpoGlobal = { modules?: Record<string, unknown> };

/** jest-expo's real `globalThis.expo` (mutated in place: replacing it breaks jest-expo's runtime). */
function expoGlobal(): ExpoGlobal {
  const expo: unknown = Reflect.get(globalThis, 'expo');
  if (!expo || typeof expo !== 'object') throw new Error('jest-expo did not install globalThis.expo');
  return expo as ExpoGlobal;
}

function sentEnvelopes(): string[] {
  return (calls.captureEnvelope || []).map((args) => Buffer.from(String(args[0]), 'base64').toString('utf8'));
}

/** Every native call except the envelopes, serialised (setContext, setTag, setExtra, addBreadcrumb, init ...). */
function otherNativeCalls(): string {
  return JSON.stringify(Object.entries(calls).filter(([name]) => name !== 'captureEnvelope'));
}

function eventOf(envelope: string): { contexts?: Record<string, Record<string, unknown>>; message?: unknown } | undefined {
  return envelope
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find((o) => o && typeof o === 'object' && 'contexts' in o) as
    | { contexts?: Record<string, Record<string, unknown>> }
    | undefined;
}

const ALLOWED_OTA_KEYS = [
  'is_enabled',
  'is_embedded_launch',
  'is_emergency_launch',
  'is_using_embedded_assets',
  'update_id',
  'channel',
  'runtime_version',
  'check_automatically',
  'launch_duration',
  'emergency_reason_category',
];

describe('OTA privacy canary: no native free-form text leaves the phone through the real SDK', () => {
  const OLD_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
  let expo: ExpoGlobal = {};
  let hadModules = false;
  let previousUpdates: unknown;
  let hadExpoContext: boolean | undefined;

  beforeAll(async () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
    // The real global the SDK's ExpoContext integration reads, installed before init.
    expo = expoGlobal();
    hadModules = !!expo.modules;
    const modules = expo.modules || {};
    expo.modules = modules;
    previousUpdates = modules.ExpoUpdates;
    modules.ExpoUpdates = { ...NATIVE_UPDATES };

    const Sentry: typeof import('@sentry/react-native') = jest.requireActual('@sentry/react-native');
    const { initSentry, setSentryUser, captureError } = jest.requireActual('../sentry');
    initSentry();
    await Sentry.getClient()?.flush(2000);
    hadExpoContext = Sentry.getClient()?.getIntegrationByName('ExpoContext') !== undefined;
    setSentryUser({ id: ACCOUNT });

    const { reportOtaUpdateLaunch, resetOtaUpdateReportForTests } = jest.requireActual('../otaUpdateTags');
    resetOtaUpdateReportForTests();
    // App.tsx order: initSentry(), then reportOtaUpdateLaunch() with its defaults.
    reportOtaUpdateLaunch();
    captureError(new Error(ORDINARY));
    await Sentry.getClient()?.flush(2000);

    // Second pass: the canary in every string field of the native constants.
    modules.ExpoUpdates = {
      ...NATIVE_UPDATES,
      updateId: CANARY_TEXT,
      channel: `clinic ${EMAIL}`,
      runtimeVersion: `${RUNTIME} ${PHONE}`,
      checkAutomatically: `ON_LOAD ${NAME}`,
      emergencyLaunchReason: CANARY_TEXT,
    };
    resetOtaUpdateReportForTests();
    reportOtaUpdateLaunch();
    captureError(new Error(ORDINARY));
    await Sentry.getClient()?.flush(2000);
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = OLD_DSN;
    if (!hadModules) delete expo.modules;
    else if (previousUpdates === undefined) delete expo.modules?.ExpoUpdates;
    else if (expo.modules) expo.modules.ExpoUpdates = previousUpdates;
  });

  it('the SDK ExpoContext integration is not installed (B-305-12)', () => {
    expect(hadExpoContext).toBe(false);
  });

  it('positive control: two emergency warnings with the closed category and the searchable tags', () => {
    const reports = sentEnvelopes().filter((e) => e.includes('OTA emergency launch'));
    expect(reports).toHaveLength(2);
    expect(reports[0]).toContain('"reason_category":"asset_or_bundle"');
    expect(reports[0]).toContain(UPDATE_ID);
    expect(reports[0]).toContain(RUNTIME);
    expect(reports[1]).toContain('"reason_category":"unknown"');
    expect(reports[1]).toContain('"expo.updates.channel":"other"');
  });

  it('positive control: an ordinary error carries the bounded ota_updates context', () => {
    const ordinary = sentEnvelopes().filter((e) => e.includes(ORDINARY));
    expect(ordinary).toHaveLength(2);
    expect(eventOf(ordinary[0])?.contexts?.ota_updates).toEqual({
      is_enabled: true,
      is_embedded_launch: true,
      is_emergency_launch: true,
      is_using_embedded_assets: true,
      update_id: UPDATE_ID,
      channel: 'clinic',
      runtime_version: RUNTIME,
      check_automatically: 'on_load',
      launch_duration: 412,
      emergency_reason_category: 'asset_or_bundle',
    });
    expect(eventOf(ordinary[1])?.contexts?.ota_updates).toMatchObject({ channel: 'other', emergency_reason_category: 'unknown' });
  });

  it('positive control: the native crash scope receives the same bounded ota_updates context', () => {
    const set = (calls.setContext || []).filter((args) => args[0] === 'ota_updates');
    expect(set.length).toBeGreaterThanOrEqual(1);
    expect(set[0][1]).toMatchObject({ update_id: UPDATE_ID, channel: 'clinic', emergency_reason_category: 'asset_or_bundle' });
    for (const args of set) {
      for (const key of Object.keys((args[1] as Record<string, unknown>) || {})) expect(ALLOWED_OTA_KEYS).toContain(key);
    }
  });

  it('no canary fragment appears in any envelope sent to the native transport', () => {
    const all = sentEnvelopes().join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const fragment of FRAGMENTS) {
      expect(all).not.toContain(fragment);
    }
    expect(all).not.toContain('emergency_launch_reason');
  });

  it('no canary fragment appears in any other native call (native crash scope: setContext, tags, extras, breadcrumbs)', () => {
    const native = otherNativeCalls();
    expect(native).toContain('setContext');
    for (const fragment of FRAGMENTS) {
      expect(native).not.toContain(fragment);
    }
    expect(native).not.toContain('emergency_launch_reason');
  });

  it('every OTA context in every event holds only allowlisted keys', () => {
    for (const env of sentEnvelopes()) {
      const contexts = eventOf(env)?.contexts ?? {};
      for (const key of Object.keys(contexts.ota_updates ?? {})) expect(ALLOWED_OTA_KEYS).toContain(key);
      if (contexts.ota_emergency) expect(Object.keys(contexts.ota_emergency)).toEqual(['reason_category']);
    }
  });
});
