/**
 * PR-HK-2.c — Samsung Health connector error taxonomy.
 *
 * Errors are explicit and typed (50-Failures #36 "no silent swallow", #50
 * "fail-explicit"). The sync service surfaces these to the caller so the
 * connection status can be set to `error` with a real `last_error` rather than
 * degrading silently to "connected" (UNIFIED_BUILD_PLAN §0 provider-outage
 * posture).
 */

/** Base class for all Samsung Health connector errors. */
export class SamsungHealthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SamsungHealthError';
    // Restore prototype chain for `instanceof` across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the connector is invoked on a non-Android platform. Samsung
 * Health is Android-only (PLATFORM GUARD: `Platform.OS === 'android'`).
 */
export class SamsungHealthUnsupportedError extends SamsungHealthError {
  constructor(platformOs: string) {
    super(
      `Samsung Health is only available on Android (Platform.OS === 'android'); ` +
        `current platform is '${platformOs}'.`,
    );
    this.name = 'SamsungHealthUnsupportedError';
  }
}

/**
 * Thrown when the Health Connect bridge that Samsung Health writes into is not
 * available/installed, or fails to initialize. Callers should degrade
 * gracefully (treat as "no Samsung data available") rather than crash.
 */
export class SamsungHealthUnavailableError extends SamsungHealthError {
  constructor(detail?: string) {
    super(
      `Samsung Health data is unavailable on this device` +
        (detail ? `: ${detail}` : '. Health Connect may not be installed.'),
    );
    this.name = 'SamsungHealthUnavailableError';
  }
}

/**
 * Thrown when the user has not granted the Health Connect read permissions the
 * connector needs (the permission-denied path).
 */
export class SamsungHealthPermissionDeniedError extends SamsungHealthError {
  /** The record types we needed read access to but were not granted. */
  readonly missingRecordTypes: string[];

  constructor(missingRecordTypes: string[]) {
    super(
      `Samsung Health read permission denied for record types: ` +
        `${missingRecordTypes.join(', ') || '(none granted)'}.`,
    );
    this.name = 'SamsungHealthPermissionDeniedError';
    this.missingRecordTypes = missingRecordTypes;
  }
}
