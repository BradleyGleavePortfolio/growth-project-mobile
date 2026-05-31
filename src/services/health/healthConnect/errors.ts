// PR-HK-2.b — Android Health Connect connector: typed errors.
//
// Explicit, named error classes keep failures observable and let the sync
// service / hook branch on cause without string-matching messages
// (50-Failures #36 "no silent swallow", #50 "fail explicit").

/**
 * Thrown when the Health Connect connector is invoked on a non-Android
 * platform. Health Connect is an Android-only API; iOS uses Apple HealthKit
 * (PR-HK-2.a) and web has no on-device health store. The platform guard at
 * every public entry point throws this rather than returning empty data, so a
 * mis-wired call site fails loud instead of silently syncing nothing.
 */
export class HealthConnectUnsupportedError extends Error {
  constructor(platform: string) {
    super(
      `Health Connect is only available on Android (current platform: "${platform}"). ` +
        'iOS uses Apple HealthKit; other platforms are unsupported.',
    );
    this.name = 'HealthConnectUnsupportedError';
    // Restore prototype chain for `instanceof` across transpilation targets.
    Object.setPrototypeOf(this, HealthConnectUnsupportedError.prototype);
  }
}

/**
 * Thrown when the Health Connect SDK fails to initialize (Health Connect app
 * not installed / not available on the device). Distinct from a permission
 * denial — initialization is the prerequisite to even asking for permissions.
 */
export class HealthConnectUnavailableError extends Error {
  constructor(message = 'Health Connect SDK failed to initialize on this device.') {
    super(message);
    this.name = 'HealthConnectUnavailableError';
    Object.setPrototypeOf(this, HealthConnectUnavailableError.prototype);
  }
}

/**
 * Thrown by the sync service when the user has not granted ANY of the
 * requested read permissions. The caller (hook/UI) surfaces a re-consent
 * prompt; a partial grant is NOT an error — we sync whatever was granted.
 */
export class HealthConnectPermissionDeniedError extends Error {
  /** The canonical record types we asked for but were not granted. */
  readonly requestedRecordTypes: string[];

  constructor(requestedRecordTypes: string[]) {
    super(
      'Health Connect read permission was denied for all requested record types. ' +
        'No data can be synced until the user grants at least one permission.',
    );
    this.name = 'HealthConnectPermissionDeniedError';
    this.requestedRecordTypes = requestedRecordTypes;
    Object.setPrototypeOf(this, HealthConnectPermissionDeniedError.prototype);
  }
}
