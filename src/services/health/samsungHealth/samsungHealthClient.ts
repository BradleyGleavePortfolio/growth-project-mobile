/**
 * PR-HK-2.c — `samsungHealthClient`
 *
 * The Samsung Health read seam. Today it reads through the Android Health
 * Connect bridge (`react-native-health-connect`) and FILTERS the returned
 * records to only those whose `metadata.dataOrigin.packageName` equals
 * `com.sec.android.app.shealth` (Samsung Health). Tomorrow a native Samsung
 * SDK module can replace {@link getBridge} with zero change to the public
 * `readRecords` / `initialize` / `getGrantedRecordTypes` contract — that is the
 * "clean seam" requirement (UNIFIED_BUILD_PLAN §0).
 *
 * This is the provider-distinct differentiator vs PR-HK-2.b (Health Connect):
 * that connector reports every Health Connect record as `HEALTH_CONNECT`; this
 * one keeps ONLY the Samsung-origin subset and reports `SAMSUNG_HEALTH`. The
 * two folders are file-disjoint by construction.
 *
 * PLATFORM GUARD: every entry point throws {@link SamsungHealthUnsupportedError}
 * off Android. Permission gaps throw {@link SamsungHealthPermissionDeniedError};
 * a missing/failed Health Connect install surfaces as
 * {@link SamsungHealthUnavailableError} (graceful-degrade signal).
 */

import { Platform } from 'react-native';
import { logger } from '../../../utils/logger';
import {
  SAMSUNG_HEALTH_PACKAGE_NAME,
  isSamsungHealthRecord,
  type SamsungHealthRecord,
  type SamsungReadRecordsOptions,
  type SamsungReadableRecordType,
} from './types';
import {
  SamsungHealthPermissionDeniedError,
  SamsungHealthUnavailableError,
  SamsungHealthUnsupportedError,
} from './errors';

const LOG_CONTEXT = 'samsungHealthClient';

/**
 * The narrow surface of `react-native-health-connect` this connector depends
 * on. Declared locally so the connector keeps a typed contract against the
 * bridge without a compile-time dependency on the native package's generated
 * types (the package is Android-native and not resolvable in every build/test
 * environment). A future Samsung SDK module implements this same shape.
 */
export interface SamsungHealthBridge {
  /** Initialize the underlying client; resolves false if unavailable. */
  initialize(): Promise<boolean>;
  /** Return the set of currently-granted permissions. */
  getGrantedPermissions(): Promise<
    Array<{ accessType: string; recordType: string }>
  >;
  /** Read records of one type within the given options. */
  readRecords(
    recordType: SamsungReadableRecordType,
    options: SamsungReadRecordsOptions,
  ): Promise<{ records: SamsungHealthRecord[]; pageToken?: string }>;
}

/**
 * Lazily resolve the native bridge. Done via `require` (not a static `import`)
 * so this module can be imported on any platform — and unit-tested with a
 * mock — without the Android-only native package being present at module-load
 * time. Tests inject a fake via {@link __setBridgeForTests}.
 */
let bridgeOverride: SamsungHealthBridge | null = null;

export function getBridge(): SamsungHealthBridge {
  if (bridgeOverride) return bridgeOverride;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('react-native-health-connect') as SamsungHealthBridge;
  return mod;
}

/** Test-only seam to inject a fake Health Connect bridge. */
export function __setBridgeForTests(bridge: SamsungHealthBridge | null): void {
  bridgeOverride = bridge;
}

/** Throw if we are not on Android (Samsung Health is Android-only). */
function assertAndroid(): void {
  if (Platform.OS !== 'android') {
    throw new SamsungHealthUnsupportedError(Platform.OS);
  }
}

/**
 * The Health Connect record types the Samsung connector reads. These map to
 * the canonical metrics enumerated in the normalizer (AGENT_2_CODING_PLAN
 * §3.1 Samsung row: "all canonical metrics, both buckets").
 */
export const SAMSUNG_REQUIRED_RECORD_TYPES: SamsungReadableRecordType[] = [
  'Steps',
  'ActiveCaloriesBurned',
  'HeartRate',
  'RestingHeartRate',
  'Vo2Max',
  'ExerciseSession',
  'Distance',
  'Weight',
  'BodyFat',
  'BloodPressure',
  'SleepSession',
  'HeartRateVariabilityRmssd',
  'OxygenSaturation',
  'RespiratoryRate',
  'BodyTemperature',
];

/**
 * Initialize the underlying bridge. Resolves the bridge handle or throws
 * {@link SamsungHealthUnavailableError} if Health Connect is not installed /
 * cannot initialize (graceful-degrade signal for the sync service).
 */
export async function initialize(): Promise<SamsungHealthBridge> {
  assertAndroid();
  const bridge = getBridge();
  let ok = false;
  try {
    ok = await bridge.initialize();
  } catch (err) {
    logger.warn(LOG_CONTEXT, 'Health Connect initialize threw', err);
    throw new SamsungHealthUnavailableError(
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!ok) {
    throw new SamsungHealthUnavailableError();
  }
  return bridge;
}

/**
 * Return the subset of {@link SAMSUNG_REQUIRED_RECORD_TYPES} for which the user
 * has granted READ access. Used by callers to decide which record types are
 * safe to read and to detect the permission-denied path.
 *
 * Note (PLATFORM GUARD detail): Health Connect permissions are per record
 * type, not per data-origin, so this reflects which Samsung-eligible record
 * types we can read at all. The Samsung-origin filtering happens at read time
 * in {@link readRecords}.
 */
export async function getGrantedRecordTypes(): Promise<SamsungReadableRecordType[]> {
  assertAndroid();
  const bridge = getBridge();
  let granted: Array<{ accessType: string; recordType: string }>;
  try {
    granted = await bridge.getGrantedPermissions();
  } catch (err) {
    logger.warn(LOG_CONTEXT, 'getGrantedPermissions threw', err);
    throw new SamsungHealthUnavailableError(
      err instanceof Error ? err.message : String(err),
    );
  }
  const grantedReadTypes = new Set(
    (granted ?? [])
      .filter((p) => p && p.accessType === 'read')
      .map((p) => p.recordType),
  );
  return SAMSUNG_REQUIRED_RECORD_TYPES.filter((t) => grantedReadTypes.has(t));
}

/**
 * Read Samsung Health records of one type within a time window.
 *
 * Behaviour:
 *  1. Android-only (PLATFORM GUARD).
 *  2. If READ permission for `recordType` is not granted →
 *     {@link SamsungHealthPermissionDeniedError}.
 *  3. Reads via the Health Connect bridge, then FILTERS to records whose
 *     `metadata.dataOrigin.packageName === 'com.sec.android.app.shealth'`.
 *     Non-Samsung-origin records (e.g. Google Fit, a Garmin sync, the phone's
 *     own step counter) are dropped — this is what makes the connector
 *     provider-distinct from PR-HK-2.b.
 *
 * The public shape matches the Health Connect `readRecords` API (same name,
 * same args) so the future native-SDK seam is drop-in.
 */
export async function readRecords(
  recordType: SamsungReadableRecordType,
  options: SamsungReadRecordsOptions,
): Promise<SamsungHealthRecord[]> {
  assertAndroid();
  const bridge = getBridge();

  // Permission guard: confirm READ access for this record type.
  const grantedTypes = await getGrantedRecordTypes();
  if (!grantedTypes.includes(recordType)) {
    throw new SamsungHealthPermissionDeniedError([recordType]);
  }

  let result: { records: SamsungHealthRecord[]; pageToken?: string };
  try {
    result = await bridge.readRecords(recordType, options);
  } catch (err) {
    logger.error(LOG_CONTEXT, `readRecords(${recordType}) failed`, err);
    throw new SamsungHealthUnavailableError(
      err instanceof Error ? err.message : String(err),
    );
  }

  const all = Array.isArray(result?.records) ? result.records : [];
  // FILTER: Samsung-origin only. This is the connector's reason to exist.
  const samsungOnly = all.filter((record) => isSamsungHealthRecord(record));

  logger.log(
    LOG_CONTEXT,
    `readRecords(${recordType}): kept ${samsungOnly.length}/${all.length} ` +
      `records with dataOrigin=${SAMSUNG_HEALTH_PACKAGE_NAME}`,
  );

  // Ensure recordType is stamped (the bridge does, but defend the contract for
  // the normalizer which switches on it).
  return samsungOnly.map((r) => ({ ...r, recordType }));
}

export const samsungHealthClient = {
  initialize,
  getGrantedRecordTypes,
  readRecords,
  SAMSUNG_REQUIRED_RECORD_TYPES,
};

export type SamsungHealthClient = typeof samsungHealthClient;
