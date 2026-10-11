/**
 * analytics.ts — PostHog React Native wrapper
 *
 * UX Psychology Report #4: Analytics Tracking
 *
 * - Lazy-initialised: safe to import at module load time even before PostHog
 *   credentials are available (e.g. during Expo tunnel dev without .env).
 * - NO-OP when EXPO_PUBLIC_POSTHOG_API_KEY (or the legacy EXPO_PUBLIC_POSTHOG_KEY)
 *   is missing.
 * - Consent (LEGAL-03, PRIV-06): nothing reaches PostHog before a person signs
 *   in. Signing in needs an account created under "By continuing, you agree to
 *   the Terms of Service and the Privacy Policy", and the Privacy Policy names
 *   PostHog. identify() (sign-in, or a signed-in cold start) is the consent
 *   point; reset() (sign-out) withdraws it. Until then no client is built and
 *   events wait in memory (at most MAX_HELD); sign-out drops them.
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

// undefined: nobody has signed in yet in this process (events are held);
// true: signed in; false: signed out (events are dropped).
let _consent: boolean | undefined;
const MAX_HELD = 20;
let _held: Array<[string, Record<string, unknown>]> = [];

function getClient(): PostHog | null {
  if (_consent !== true) return null;
  if (_client) return _client;

  const key = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const host =
    process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

  if (!key) {
    if (!_warnedOnce && __DEV__) {
      console.warn('[analytics] EXPO_PUBLIC_POSTHOG_API_KEY not set — analytics are disabled.');
      _warnedOnce = true;
    }
    return null;
  }

  try {
    // No automatic events or replay; see AnalyticsProvider in App.tsx.
    _client = new PostHog(key, {
      host,
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
    });
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
    if (_consent === undefined) {
      if (_held.length < MAX_HELD) _held.push([event, stripPII(props)]);
      return;
    }
    getClient()?.capture(event, stripPII(props) as never);
  } catch {
    // never crash the caller
  }
}

/**
 * Alias for `track` — matches PostHog naming convention.
 */
export const capture = track;

/**
 * Associate subsequent events with a user identity. Call only once a person
 * is signed in: this is the consent point (see the header). Events held
 * since launch are sent after it.
 * `userId` is an opaque server-side ID (not an email).
 */
export function identify(
  userId: string,
  props?: Record<string, unknown>,
): void {
  _consent = true;
  const held = _held;
  _held = [];
  try {
    const client = getClient();
    client?.identify(userId, stripPII(props) as never);
    held.forEach(([event, p]) => client?.capture(event, p as never));
  } catch {
    // no-op
  }
}

/**
 * Reset PostHog state on sign-out so the next user gets a fresh anonymous ID.
 */
export function reset(): void {
  // Sign-out: nothing more is sent until the next sign-in.
  _consent = false;
  _held = [];
  try {
    _client?.reset();
  } catch {
    // no-op
  }
}

/**
 * Expose the raw PostHog client for advanced use (e.g. feature flags).
 * Returns null when the key is not configured or nobody is signed in.
 */
export function getPostHogClient(): PostHog | null {
  return getClient();
}
