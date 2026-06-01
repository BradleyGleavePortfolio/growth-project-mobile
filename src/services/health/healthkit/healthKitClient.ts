/**
 * PR-HK-2.a — Apple HealthKit on-device client.
 *
 * A thin, typed wrapper around `react-native-health`'s `AppleHealthKit`
 * native module. This is the ONLY file in the HealthKit connector that
 * touches the native bridge directly; the normalizer and sync service depend
 * only on the typed shapes exported here (50-Failures #14 layering, #40/#41
 * single-implementation — never reach into the native module elsewhere).
 *
 * Design notes:
 *  - `react-native-health` exposes a callback-style API. We promisify each
 *    call once, here, so every consumer gets `async/await` + typed results.
 *  - HealthKit is **iOS-only**. Every public method guards
 *    `Platform.OS === 'ios'` and throws {@link HealthKitUnsupportedError} on
 *    any other platform (the package's native module is simply absent on
 *    Android/web, so calling it would throw an opaque runtime error — we
 *    fail loud and clear instead, 50-Failures #36/#50).
 *  - This is an ON-DEVICE provider (Agent 2 §3, UNIFIED_BUILD_PLAN lock
 *    "On-device native modules"): there is no OAuth, no server token. The
 *    device grants per-type read permission; we read samples and the sync
 *    service POSTs pre-normalized samples to the backend.
 *  - Backend ingest endpoint contract: at the time this PR was authored no
 *    ingest route exists on `growth-project-backend@main`
 *    (`src/wearables/connections/connections.controller.ts` documents the
 *    intended `POST /v1/wearables/ingest` but does not implement it). We
 *    therefore target `POST /v1/wearables/samples/ingest` as the documented
 *    client-side contract and mark the backend endpoint as a stub TODO for
 *    the integration PR (see `healthKitSyncService.ts`).
 */

import { Platform } from 'react-native';
// `react-native-health` ships its own type declarations; we re-declare the
// narrow slice we use as `HealthKitNativeModule` below so this connector does
// not break if the upstream `.d.ts` shifts, and so tests can `jest.mock` it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import AppleHealthKitDefault from 'react-native-health';

/**
 * Thrown when any HealthKit operation is attempted on a non-iOS platform.
 * `react-native-health` is iOS-only; on Android/web the native module does
 * not exist. Callers (e.g. the Connections Hub hook) catch this to render a
 * clear "not available on this device" state rather than a native crash.
 */
export class HealthKitUnsupportedError extends Error {
  constructor(operation: string) {
    super(
      `Apple HealthKit is only available on iOS (attempted "${operation}" on ${Platform.OS}).`,
    );
    this.name = 'HealthKitUnsupportedError';
    // Restore prototype chain for `instanceof` across the TS/Babel transpile.
    Object.setPrototypeOf(this, HealthKitUnsupportedError.prototype);
  }
}

/**
 * Canonical permission identifiers (a subset of `react-native-health`'s
 * `HealthPermission` enum) for the data types this connector reads. Kept as a
 * string-literal union so the sync service can request exactly these without
 * importing the native module.
 */
export type HealthKitReadPermission =
  | 'StepCount'
  | 'ActiveEnergyBurned'
  | 'RestingHeartRate'
  | 'HeartRate'
  | 'Vo2Max'
  | 'Workout'
  | 'Weight'
  | 'BodyFatPercentage'
  | 'BloodPressureSystolic'
  | 'BloodPressureDiastolic'
  | 'SleepAnalysis'
  | 'HeartRateVariability'
  | 'OxygenSaturation'
  | 'RespiratoryRate'
  | 'BodyTemperature';

/** Time window for a read query. */
export interface HealthKitQueryWindow {
  /** Inclusive lower bound. */
  since: Date;
  /** Exclusive upper bound. */
  until: Date;
}

/**
 * A generic quantity/category sample as returned by `react-native-health`
 * read methods. `value` is numeric for quantity types (steps, bpm, kg…) and a
 * string for category types (sleep stage labels like "DEEP"/"REM"). We model
 * both because the sleep reader returns the string variant.
 */
export interface HealthKitSample {
  /** Provider-native record id, if HealthKit assigns one. */
  id?: string;
  /** ISO8601 start of the observation window. */
  startDate: string;
  /** ISO8601 end of the observation window. */
  endDate: string;
  /** Numeric value (quantity types) or category label (e.g. sleep stage). */
  value: number | string;
  /** Optional source/device metadata bag. */
  metadata?: Record<string, unknown>;
  /** Originating app/source name, when present. */
  sourceName?: string;
}

/** Blood-pressure sample carries two readings in one record. */
export interface HealthKitBloodPressureSample {
  id?: string;
  startDate: string;
  endDate: string;
  bloodPressureSystolicValue: number;
  bloodPressureDiastolicValue: number;
}

/** Workout sample as returned by `getAnchoredWorkouts`. */
export interface HealthKitWorkoutSample {
  id: string;
  activityName: string;
  /** Active energy in kcal. */
  calories: number;
  /** Distance in metres. */
  distance: number;
  /** Duration in seconds. */
  duration: number;
  start: string;
  end: string;
  sourceName?: string;
}

/**
 * The set of metric reader keys this connector supports. The sync service
 * iterates these; the client routes each to the correct native call.
 */
export type HealthKitMetricKey =
  | 'steps'
  | 'activeEnergy'
  | 'restingHeartRate'
  | 'heartRate'
  | 'vo2Max'
  | 'workouts'
  | 'weight'
  | 'bodyFat'
  | 'bloodPressure'
  | 'sleep'
  | 'hrv'
  | 'spo2'
  | 'respiratoryRate'
  | 'bodyTemperature';

/**
 * The narrow native surface this client depends on. Declared locally (rather
 * than importing the upstream type) so the connector is insulated from
 * upstream `.d.ts` drift and so `jest.mock('react-native-health')` can supply
 * a structurally-compatible double.
 */
type HKCallback<T> = (error: string | null, results: T) => void;
interface HKInputOptions {
  startDate?: string;
  endDate?: string;
  ascending?: boolean;
  type?: string;
  limit?: number;
}
interface HKPermissions {
  permissions: { read: string[]; write: string[] };
}
interface HKAnchoredWorkoutResults {
  anchor: string;
  data: HealthKitWorkoutSample[];
}
interface HealthKitNativeModule {
  initHealthKit(permissions: HKPermissions, cb: HKCallback<unknown>): void;
  getStepCount(o: HKInputOptions, cb: HKCallback<HealthKitSample>): void;
  getActiveEnergyBurned(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getRestingHeartRateSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getHeartRateSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getVo2MaxSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getAnchoredWorkouts(o: HKInputOptions, cb: HKCallback<HKAnchoredWorkoutResults>): void;
  getWeightSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getBodyFatPercentageSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getBloodPressureSamples(o: HKInputOptions, cb: HKCallback<HealthKitBloodPressureSample[]>): void;
  getSleepSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getHeartRateVariabilitySamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getOxygenSaturationSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getRespiratoryRateSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
  getBodyTemperatureSamples(o: HKInputOptions, cb: HKCallback<HealthKitSample[]>): void;
}

const AppleHealthKit = AppleHealthKitDefault as unknown as HealthKitNativeModule;

/** Guard helper — throw a clear error off iOS. */
function assertIos(operation: string): void {
  if (Platform.OS !== 'ios') {
    throw new HealthKitUnsupportedError(operation);
  }
}

/** Promisify a callback whose result is the second argument. */
function promisify<T>(
  fn: (cb: HKCallback<T>) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn((error, results) => {
      if (error) {
        reject(new Error(typeof error === 'string' ? error : 'HealthKit error'));
        return;
      }
      resolve(results);
    });
  });
}

function toOptions(window: HealthKitQueryWindow): HKInputOptions {
  return {
    startDate: window.since.toISOString(),
    endDate: window.until.toISOString(),
    ascending: true,
  };
}

/**
 * The result bag of a full read pass. Each field is independently optional so
 * a single metric's permission denial or read failure does not abort the rest
 * (the sync service decides batch-level error semantics).
 */
export interface HealthKitReadResult {
  steps?: HealthKitSample[];
  activeEnergy?: HealthKitSample[];
  restingHeartRate?: HealthKitSample[];
  heartRate?: HealthKitSample[];
  vo2Max?: HealthKitSample[];
  workouts?: HealthKitWorkoutSample[];
  weight?: HealthKitSample[];
  bodyFat?: HealthKitSample[];
  bloodPressure?: HealthKitBloodPressureSample[];
  sleep?: HealthKitSample[];
  hrv?: HealthKitSample[];
  spo2?: HealthKitSample[];
  respiratoryRate?: HealthKitSample[];
  bodyTemperature?: HealthKitSample[];
}

/**
 * The default read-permission set for a full HealthKit sync. Mirrors the
 * Info.plist usage strings and Health Connect permissions declared in
 * PR-HK-CFG (mobile #218).
 */
export const HEALTHKIT_READ_PERMISSIONS: HealthKitReadPermission[] = [
  'StepCount',
  'ActiveEnergyBurned',
  'RestingHeartRate',
  'HeartRate',
  'Vo2Max',
  'Workout',
  'Weight',
  'BodyFatPercentage',
  'BloodPressureSystolic',
  'BloodPressureDiastolic',
  'SleepAnalysis',
  'HeartRateVariability',
  'OxygenSaturation',
  'RespiratoryRate',
  'BodyTemperature',
];

/**
 * Typed HealthKit client. Stateless — safe to instantiate once and reuse.
 */
export class HealthKitClient {
  /** Whether HealthKit is usable on this platform (iOS only). */
  get isSupported(): boolean {
    return Platform.OS === 'ios';
  }

  /**
   * Request read authorization for the given HealthKit types. Resolves once
   * the consent sheet has been presented and dismissed. Note: HealthKit does
   * NOT report per-type grant/deny back to JS (privacy by design), so a
   * resolved promise means "the user has been asked", not "all granted" —
   * reads for denied types simply return empty arrays.
   */
  async requestAuth(
    types: HealthKitReadPermission[] = HEALTHKIT_READ_PERMISSIONS,
  ): Promise<void> {
    assertIos('requestAuth');
    const permissions: HKPermissions = {
      permissions: { read: types, write: [] },
    };
    await promisify<unknown>((cb) => AppleHealthKit.initHealthKit(permissions, cb));
  }

  /**
   * Read all supported metric samples in `[since, until)`. Per-metric reads
   * run concurrently; an individual metric that rejects is surfaced as an
   * omitted field (the caller's normalizer drops anything absent). The whole
   * call still rejects only if invoked off-iOS.
   */
  async readSamples(window: HealthKitQueryWindow): Promise<HealthKitReadResult> {
    assertIos('readSamples');
    const o = toOptions(window);

    // Run each reader independently; tolerate a single metric failing
    // (e.g. permission not granted) without losing the others (#50 graceful).
    const settle = async <T>(fn: (cb: HKCallback<T>) => void): Promise<T | undefined> => {
      try {
        return await promisify<T>(fn);
      } catch {
        return undefined;
      }
    };

    const [
      stepResult,
      activeEnergy,
      restingHeartRate,
      heartRate,
      vo2Max,
      anchoredWorkouts,
      weight,
      bodyFat,
      bloodPressure,
      sleep,
      hrv,
      spo2,
      respiratoryRate,
      bodyTemperature,
    ] = await Promise.all([
      settle<HealthKitSample>((cb) => AppleHealthKit.getStepCount(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getActiveEnergyBurned(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getRestingHeartRateSamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getHeartRateSamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getVo2MaxSamples(o, cb)),
      settle<HKAnchoredWorkoutResults>((cb) => AppleHealthKit.getAnchoredWorkouts(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getWeightSamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getBodyFatPercentageSamples(o, cb)),
      settle<HealthKitBloodPressureSample[]>((cb) => AppleHealthKit.getBloodPressureSamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getSleepSamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getHeartRateVariabilitySamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getOxygenSaturationSamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getRespiratoryRateSamples(o, cb)),
      settle<HealthKitSample[]>((cb) => AppleHealthKit.getBodyTemperatureSamples(o, cb)),
    ]);

    // `getStepCount` returns a single aggregate HealthValue; wrap to an array
    // so the normalizer has one uniform shape across quantity metrics.
    const steps = stepResult ? [stepResult] : undefined;

    return {
      steps,
      activeEnergy,
      restingHeartRate,
      heartRate,
      vo2Max,
      workouts: anchoredWorkouts?.data,
      weight,
      bodyFat,
      bloodPressure,
      sleep,
      hrv,
      spo2,
      respiratoryRate,
      bodyTemperature,
    };
  }
}

/** Shared singleton — the client is stateless. */
export const healthKitClient = new HealthKitClient();
