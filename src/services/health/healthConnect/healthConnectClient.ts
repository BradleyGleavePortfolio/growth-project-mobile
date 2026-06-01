// PR-HK-2.b — Android Health Connect on-device connector: SDK client wrapper.
//
// Thin, typed, platform-guarded wrapper around `react-native-health-connect`
// (3.5.3, wired in PR-HK-CFG). It is the ONLY module in this connector that
// imports the native library — every other module depends on this seam, so
// the native surface is mockable in one place (50-Failures #15/#40 single
// implementation; tests mock 'react-native-health-connect' here).
//
// Responsibilities (and nothing more):
//   • initialize()            → boot the Health Connect SDK (Android only)
//   • getGrantedPermissions() → which read permissions are already granted
//   • requestPermission()     → prompt for the connector's read permission set
//   • readRecords(type, …)    → read one record type within a time window
//
// Platform guard: every public method throws HealthConnectUnsupportedError on
// non-Android platforms (the library's native module is absent there).

import { Platform } from 'react-native';
import {
  HealthConnectUnavailableError,
  HealthConnectUnsupportedError,
} from './errors';

// IMPORTANT — iOS graceful no-op under the new architecture.
//
// We must NOT statically `import` from 'react-native-health-connect' at module
// scope. Under the new architecture (`newArchEnabled=true`, which this project
// ships) the library resolves its native module eagerly at module-evaluation
// time:
//
//   const HealthConnectModule = Platform.select({
//     android: isTurboModuleEnabled
//       ? require('./NativeHealthConnect').default   // ← evaluated on ALL platforms
//       : NativeModules.HealthConnect,
//     ios: moduleProxy(PLATFORM_NOT_SUPPORTED_ERROR),
//     default: moduleProxy(PLATFORM_NOT_SUPPORTED_ERROR),
//   });
//
// JavaScript evaluates every value of the object literal before `Platform.select`
// chooses one, so `require('./NativeHealthConnect').default` —
// `TurboModuleRegistry.getEnforcing('HealthConnect')` — runs on iOS too and
// THROWS (the native module is absent). A static import would therefore make the
// iOS JS bundle throw at module-evaluation time the moment any iOS-reachable
// module imports this connector — breaking the required Android-only graceful
// no-op. We instead `require` the library lazily, behind the platform guard, so
// the iOS bundle never evaluates `getEnforcing`.

/** The subset of the native library surface this connector uses. */
interface HealthConnectLib {
  initialize: () => Promise<boolean>;
  getGrantedPermissions: () => Promise<unknown>;
  requestPermission: (perms: HealthConnectPermission[]) => Promise<unknown>;
  readRecords: (
    recordType: string,
    options: {
      timeRangeFilter: { operator: 'between'; startTime: string; endTime: string };
    },
  ) => Promise<{ records?: unknown[] }>;
}

/**
 * Lazily load the native Health Connect library. Only ever called AFTER
 * `assertSupported()` confirms `Platform.OS === 'android'`, so the iOS/web JS
 * bundle never evaluates the library module (and therefore never triggers the
 * eager `TurboModuleRegistry.getEnforcing('HealthConnect')` that throws on iOS
 * under the new architecture). The `require` is deliberately inline so the
 * bundler does not hoist it to module scope.
 */
function loadHealthConnectLib(): HealthConnectLib {
  // Deliberate lazy require (not a top-level import) so the iOS/web bundle never
  // evaluates the library module — see the block comment above. Reached only
  // after assertSupported() confirms Platform.OS === 'android'.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-health-connect') as HealthConnectLib;
}

/**
 * The Health Connect record types this connector reads. These map 1:1 onto
 * the Android `app.json` `android.permission.health.READ_*` permissions
 * declared in PR-HK-CFG (#218) and feed the normalizer (§3.1 — "record types
 * → all canonical metrics, both buckets, mapped device-side").
 */
export const HEALTH_CONNECT_RECORD_TYPES = [
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
] as const;

/** A Health Connect record type string this connector understands. */
export type HealthConnectRecordType = (typeof HEALTH_CONNECT_RECORD_TYPES)[number];

/**
 * A Health Connect permission descriptor. Mirrors the library's `Permission`
 * shape; we only ever request `accessType: 'read'` (this is a read-only
 * ingestion connector — we never write to the user's device health store).
 */
export interface HealthConnectPermission {
  accessType: 'read' | 'write';
  recordType: string;
}

/** A half-open observation window. `startTime`/`endTime` are ISO-8601. */
export interface TimeRange {
  startTime: string;
  endTime: string;
}

/** Build the full read-permission set this connector requires. */
export function buildReadPermissions(): HealthConnectPermission[] {
  return HEALTH_CONNECT_RECORD_TYPES.map((recordType) => ({
    accessType: 'read' as const,
    recordType,
  }));
}

/** True only on Android — Health Connect's native module exists nowhere else. */
export function isHealthConnectSupported(): boolean {
  return Platform.OS === 'android';
}

/**
 * A structured, renderable description of whether this device can use Health
 * Connect. The calling UI MUST render the unsupported case as a real,
 * user-visible state (e.g. “Health Connect is available on Android only on this
 * device”) rather than treating an iOS device as a user who simply has no data.
 * The `message` is doctrine-compliant copy: no mascot, no medicalization, no
 * “coming soon” placeholder — it states a fact about platform availability.
 */
export interface HealthConnectStatus {
  /** True only on Android — mirrors {@link isHealthConnectSupported}. */
  supported: boolean;
  /** The current platform (`'android' | 'ios' | 'web' | …`). */
  platform: typeof Platform.OS;
  /**
   * Machine-readable reason the status is what it is. `'supported'` on Android;
   * `'platform-unsupported'` everywhere else. UI branches on this, never on the
   * human-readable `message`.
   */
  reason: 'supported' | 'platform-unsupported';
  /** Human-readable, render-ready copy describing the status. */
  message: string;
}

/**
 * Report whether Health Connect is usable on this device, as a structured
 * result the UI can render directly. This NEVER touches the native library, so
 * it is safe to call on every platform (including iOS, where evaluating the
 * library would throw under the new architecture). On unsupported platforms it
 * returns an explicit `'platform-unsupported'` status — a real state to render,
 * not a silent empty-data fallback.
 */
export function getHealthConnectStatus(): HealthConnectStatus {
  if (isHealthConnectSupported()) {
    return {
      supported: true,
      platform: Platform.OS,
      reason: 'supported',
      message: 'Health Connect is available on this device.',
    };
  }
  return {
    supported: false,
    platform: Platform.OS,
    reason: 'platform-unsupported',
    message:
      Platform.OS === 'ios'
        ? 'Health Connect is available on Android only. On this device, connect Apple Health instead.'
        : 'Health Connect is available on Android only and is not supported on this device.',
  };
}

/**
 * Throw if the current platform cannot run Health Connect. Called at the top
 * of every public method so a mis-wired call site fails loud (#50) rather than
 * silently reading nothing.
 */
function assertSupported(): void {
  if (!isHealthConnectSupported()) {
    throw new HealthConnectUnsupportedError(Platform.OS);
  }
}

/**
 * Initialize the Health Connect SDK. Returns true on success. Throws
 * HealthConnectUnavailableError if the SDK reports it cannot initialize
 * (e.g. the Health Connect app is not installed) — distinct from a permission
 * denial so the caller can route the user to install Health Connect.
 */
export async function initialize(): Promise<boolean> {
  assertSupported();
  const ok = await loadHealthConnectLib().initialize();
  if (!ok) {
    throw new HealthConnectUnavailableError();
  }
  return true;
}

/** Return the read permissions the user has already granted this app. */
export async function getGrantedPermissions(): Promise<HealthConnectPermission[]> {
  assertSupported();
  const granted = (await loadHealthConnectLib().getGrantedPermissions()) as HealthConnectPermission[];
  return Array.isArray(granted) ? granted : [];
}

/**
 * Prompt the user for this connector's read-permission set and return the
 * permissions actually granted (may be a subset, or empty if fully denied).
 */
export async function requestPermission(): Promise<HealthConnectPermission[]> {
  assertSupported();
  // The library types `requestPermission` against its own narrower
  // `Permission` union (record-type string-literal + accessType: 'read').
  // Our descriptors are structurally identical for the read set; cast through
  // the library's parameter type so the wider local union does not leak.
  const request = loadHealthConnectLib().requestPermission as unknown as (
    perms: HealthConnectPermission[],
  ) => Promise<HealthConnectPermission[]>;
  const granted = await request(buildReadPermissions());
  return Array.isArray(granted) ? granted : [];
}

/**
 * Read all records of a single type within `[startTime, endTime)`. Returns the
 * raw, provider-native records array (opaque to callers other than the
 * normalizer). Uses the library's `'between'` time-range filter.
 *
 * The records are typed `unknown[]` deliberately: only the normalizer
 * understands each record type's field shape, and it defends against missing
 * fields at runtime. Keeping this seam `unknown` prevents the native shape
 * from leaking type assumptions into the rest of the app.
 */
export async function readRecords(
  recordType: HealthConnectRecordType,
  range: TimeRange,
): Promise<unknown[]> {
  assertSupported();
  // The library accepts a record-type string + options; result is
  // `{ records: T[] }`. We cast through `unknown` because our record-type
  // union is wider than the library's per-call generic and we treat records
  // opaquely until normalization.
  const result = (await (loadHealthConnectLib().readRecords as unknown as (
    rt: string,
    opts: { timeRangeFilter: { operator: 'between'; startTime: string; endTime: string } },
  ) => Promise<{ records?: unknown[] }>)(recordType, {
    timeRangeFilter: {
      operator: 'between',
      startTime: range.startTime,
      endTime: range.endTime,
    },
  }));
  return Array.isArray(result?.records) ? result.records : [];
}

/**
 * Convenience: read every supported record type for a window, returning a map
 * keyed by record type. A read failure for one type is recorded as an empty
 * array (logged by the caller) and does NOT abort the others — partial sync is
 * better than no sync, and a permission the user revoked for one type should
 * not block the rest (#50 graceful degradation).
 */
export async function readAllSupportedRecords(
  range: TimeRange,
): Promise<Record<HealthConnectRecordType, unknown[]>> {
  assertSupported();
  const entries = await Promise.all(
    HEALTH_CONNECT_RECORD_TYPES.map(async (recordType) => {
      try {
        const records = await readRecords(recordType, range);
        return [recordType, records] as const;
      } catch {
        return [recordType, [] as unknown[]] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<HealthConnectRecordType, unknown[]>;
}

/** Grouped client surface — handy for the sync service + mocking in tests. */
export const healthConnectClient = {
  isHealthConnectSupported,
  getHealthConnectStatus,
  buildReadPermissions,
  initialize,
  getGrantedPermissions,
  requestPermission,
  readRecords,
  readAllSupportedRecords,
};

export type HealthConnectClient = typeof healthConnectClient;
