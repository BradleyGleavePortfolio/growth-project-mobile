/**
 * The closed shapes of over-the-air update diagnostics (B-305-10, B-305-12).
 *
 * Pure (no imports), so both the reporter (src/services/otaUpdateTags.ts) and
 * the Sentry content policy (src/services/sentryPrivacy.ts) can apply the
 * same rules: an update id is a UUID, a channel is one of the configured
 * channels (else `other`), a runtime is a short fingerprint-like token, and
 * the native emergency-launch reason is only ever a closed category. Native
 * free-form text (the reason is an exception's message) never matches any of
 * these shapes, so it can never be sent.
 */

/** The only emergency-launch reason values that are ever sent. */
export const EMERGENCY_REASON_CATEGORIES = [
  'not_reported',
  'launch_failed',
  'asset_or_bundle',
  'database',
  'timeout',
  'unknown',
] as const;
export type EmergencyReasonCategory = (typeof EMERGENCY_REASON_CATEGORIES)[number];

/** The OTA channels configured in eas.json; any other value is reported as `other`. */
export const OTA_CHANNELS = ['clinic', 'production', 'preview'] as const;

/** expo-updates `checkAutomatically` values (app.json uses ON_LOAD), lowercased as the SDK reports them. */
export const OTA_CHECK_MODES = ['on_load', 'on_error_recovery', 'wifi_only', 'never'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUNTIME_TOKEN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
/** A launch longer than a day is not a launch duration; the value is dropped. */
const MAX_LAUNCH_DURATION_MS = 86_400_000;

/** A lowercase UUID, or null. */
export function safeUpdateId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return UUID.test(v) ? v : null;
}

/** A configured channel, `other` for any other text, or null when absent. */
export function safeChannel(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  return (OTA_CHANNELS as readonly string[]).includes(v) ? v : 'other';
}

/** A fingerprint-like runtime token, or null. */
export function safeRuntimeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return RUNTIME_TOKEN.test(v) ? v : null;
}

/** A closed check mode, or null. */
export function safeCheckMode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (OTA_CHECK_MODES as readonly string[]).includes(v) ? v : null;
}

/** A launch duration in milliseconds, or null. */
export function safeLaunchDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_LAUNCH_DURATION_MS
    ? value
    : null;
}

/** True only for one of the closed reason categories. */
export function isEmergencyReasonCategory(value: unknown): value is EmergencyReasonCategory {
  return typeof value === 'string' && (EMERGENCY_REASON_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The native emergency-launch reason as a closed category. The text is read
 * on the device only to choose the category; it is never stored or sent.
 */
export function emergencyReasonCategory(reason: string | null): EmergencyReasonCategory {
  if (!reason) return 'not_reported';
  if (/time(?:d)?\s*out|timeout/i.test(reason)) return 'timeout';
  if (/database|sqlite/i.test(reason)) return 'database';
  if (/asset|bundle|manifest|\.hbc\b|\.js\b/i.test(reason)) return 'asset_or_bundle';
  if (/launch/i.test(reason)) return 'launch_failed';
  return 'unknown';
}

/** The boolean keys of the `ota_updates` context. */
const OTA_BOOLEAN_KEYS = ['is_enabled', 'is_embedded_launch', 'is_emergency_launch', 'is_using_embedded_assets'] as const;

export type OtaUpdatesContext = Record<string, string | number | boolean>;

/**
 * The `ota_updates` Sentry context reduced to its allowlist (B-305-12): the
 * four booleans, a UUID update id, a closed channel, a runtime token, a closed
 * check mode, a bounded launch duration and a closed reason category. Every
 * other key (the SDK's raw `emergency_launch_reason` above all) is dropped.
 * Returns undefined when nothing safe is left.
 */
export function sanitizeOtaUpdatesContext(raw: unknown): OtaUpdatesContext | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const get = (key: string): unknown => Reflect.get(raw, key);
  const out: OtaUpdatesContext = {};
  for (const key of OTA_BOOLEAN_KEYS) {
    const v = get(key);
    if (typeof v === 'boolean') out[key] = v;
  }
  const updateId = safeUpdateId(get('update_id'));
  if (updateId) out.update_id = updateId;
  const channel = safeChannel(get('channel'));
  if (channel) out.channel = channel;
  const runtime = safeRuntimeVersion(get('runtime_version'));
  if (runtime) out.runtime_version = runtime;
  const check = safeCheckMode(get('check_automatically'));
  if (check) out.check_automatically = check;
  const duration = safeLaunchDuration(get('launch_duration'));
  if (duration !== null) out.launch_duration = duration;
  const category = get('emergency_reason_category');
  if (isEmergencyReasonCategory(category)) out.emergency_reason_category = category;
  return Object.keys(out).length ? out : undefined;
}

/** The `ota_emergency` context: the closed reason category only, else undefined. */
export function sanitizeOtaEmergencyContext(raw: unknown): { reason_category: EmergencyReasonCategory } | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const category = Reflect.get(raw, 'reason_category');
  return isEmergencyReasonCategory(category) ? { reason_category: category } : undefined;
}
