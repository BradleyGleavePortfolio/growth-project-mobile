/**
 * analytics.ts — PostHog React Native wrapper
 *
 * UX Psychology Report #4: Analytics Tracking
 *
 * - Lazy-initialised: safe to import at module load time even before PostHog
 *   credentials are available (e.g. during Expo tunnel dev without .env).
 * - NO-OP when EXPO_PUBLIC_POSTHOG_KEY is missing.
 * - PII stripping: blocks `email`, `password`, `name`, `phone`, `address` keys.
 * - Never throws — all public methods are guarded.
 */

import PostHog from 'posthog-react-native';

// ─── PII allow-list ───────────────────────────────────────────────────────────

/**
 * Keys that are NOT allowed in event properties.
 * We drop them silently to avoid PII leaking to PostHog.
 */
const PII_DENY_KEYS = new Set([
  'email',
  'password',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'phone',
  'phone_number',
  'address',
  'street',
  'city',
  'zip',
  'postcode',
]);

function stripPII(props?: Record<string, unknown>): Record<string, unknown> {
  if (!props) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!PII_DENY_KEYS.has(key.toLowerCase())) {
      clean[key] = value;
    }
  }
  return clean;
}

// ─── Lazy PostHog client ──────────────────────────────────────────────────────

let _client: PostHog | null = null;
let _warnedOnce = false;

function getClient(): PostHog | null {
  if (_client) return _client;

  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const host =
    process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

  if (!key) {
    if (!_warnedOnce && __DEV__) {
      console.warn('[analytics] EXPO_PUBLIC_POSTHOG_KEY not set — analytics are disabled.');
      _warnedOnce = true;
    }
    return null;
  }

  try {
    _client = new PostHog(key, { host });
  } catch (err) {
    if (__DEV__) console.warn('[analytics] PostHog init failed:', err);
  }

  return _client;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Track a custom event. Props are PII-stripped before sending.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  try {
    getClient()?.capture(event, stripPII(props));
  } catch {
    // never crash the caller
  }
}

/**
 * Alias for `track` — matches PostHog naming convention.
 */
export const capture = track;

/**
 * Associate subsequent events with a user identity.
 * `userId` is an opaque server-side ID (not an email).
 */
export function identify(
  userId: string,
  props?: Record<string, unknown>,
): void {
  try {
    getClient()?.identify(userId, stripPII(props));
  } catch {
    // no-op
  }
}

/**
 * Reset PostHog state on sign-out so the next user gets a fresh anonymous ID.
 */
export function reset(): void {
  try {
    getClient()?.reset();
  } catch {
    // no-op
  }
}

/**
 * Expose the raw PostHog client for advanced use (e.g. feature flags).
 * Returns null when the key is not configured.
 */
export function getPostHogClient(): PostHog | null {
  return getClient();
}
