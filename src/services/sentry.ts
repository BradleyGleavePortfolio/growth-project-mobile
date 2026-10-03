import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { scrubBreadcrumb, scrubEvent } from './sentryPrivacy';

let initialized = false;

/**
 * Options only the native SDKs read (not part of the JS option type). iOS:
 * no NSURLSession breadcrumbs (full request URLs) and no native HTTP spans
 * (JS owns tracing).
 */
export const NATIVE_PRIVACY_OPTIONS = {
  enableNetworkBreadcrumbs: false,
  enableNetworkTracking: false,
} as const;

/**
 * Build the release identifier that the running app reports to Sentry. It
 * must match the release name the EAS build uploaded source maps under,
 * otherwise Sentry cannot symbolicate the stack and the issue page reads
 * minified Hermes bundle indices instead of source lines.
 *
 * Format mirrors what `@sentry/react-native/expo` (the Sentry config plugin)
 * uses by default: `<applicationId>@<version>+<buildNumber|versionCode>`. We
 * derive the right-hand half from the Expo runtime config so a debug build,
 * a TestFlight build, and an App Store build can never collide.
 *
 * Falls back to the bare `version` when the per-platform build code is
 * missing (older Expo configs, web). Returns `undefined` when no version is
 * available so Sentry's own auto-detection takes over.
 */
function buildReleaseId(): string | undefined {
  const cfg = Constants.expoConfig;
  const version = cfg?.version;
  if (!version) return undefined;
  const build = Platform.select({
    ios: cfg?.ios?.buildNumber,
    android:
      cfg?.android?.versionCode != null
        ? String(cfg.android.versionCode)
        : undefined,
    default: undefined,
  });
  return build ? `${version}+${build}` : version;
}

/**
 * Initialise Sentry once at app boot.
 *
 * The DSN is read from EXPO_PUBLIC_SENTRY_DSN at build time. If the DSN is
 * missing (e.g. local dev without secrets) Sentry quietly stays uninitialised
 * — the wrap()/captureException helpers below become no-ops so the rest of
 * the app behaves identically.
 */
export function initSentry(): void {
  if (initialized) return;

  const dsn =
    process.env.EXPO_PUBLIC_SENTRY_DSN ||
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
      ?.sentryDsn;

  if (!dsn || typeof dsn !== 'string') {
    return;
  }

  Sentry.init({
    dsn,
    // Adjust sample rates per environment. 1.0 means "send everything";
    // dial down once we have real traffic.
    tracesSampleRate: 0.2,
    // Replays are heavy on Android — keep disabled until we explicitly opt in.
    enableAutoSessionTracking: true,
    // Don't crash the app if Sentry itself blows up.
    enableNative: true,
    // Native-only keys: the RN SDK forwards every non-function option to
    // the native SDK it re-initializes (iOS reads them in
    // SentryOptionsInternal initWithDict), so the pre-JS suppression in
    // plugins/withSentryNativeInit.js survives JS startup. Android keeps it
    // through the io.sentry.breadcrumbs.network-events manifest flag that
    // the same plugin writes (B-330-3).
    ...NATIVE_PRIVACY_OPTIONS,
    // No PII (owner rule: no health data, no message content). These match
    // the pre-JS native init in plugins/withSentryNativeInit.js, which this
    // call re-initializes: no IP / default PII, no screenshots or view
    // hierarchy (they can show health values and messages), no failed-request
    // events (request URLs).
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    // Explicit content policy (src/services/sentryPrivacy.ts): sendDefaultPii
    // does not redact console text or request URLs. beforeBreadcrumb runs
    // before scope sync copies a breadcrumb to native; beforeSend also covers
    // native breadcrumbs merged into JS events; transactions lose URL queries.
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    environment: process.env.EXPO_PUBLIC_ENVIRONMENT || 'production',
    release: buildReleaseId(),
  });

  initialized = true;
}

/** Wrap the root component so Sentry can attach an error boundary. */
export const wrap: <P extends Record<string, unknown>>(
  component: React.ComponentType<P>,
) => React.ComponentType<P> = Sentry.wrap as never;

/** Manual capture for catch-blocks where we still want to surface the error. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
      // The support reference a person quotes is searchable as a tag (B-326-4).
      if (typeof context.reference === 'string' && context.reference) {
        scope.setTag('reference', context.reference);
      }
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}

/**
 * Tag the current user so events are attributable. Call after login.
 * Only the opaque account id is sent: the email is personal data and is
 * never attached (it would also reach native crash reports through scope
 * sync).
 */
export function setSentryUser(user: { id: string } | null): void {
  if (!initialized) return;
  if (user) {
    Sentry.setUser({ id: user.id });
  } else {
    Sentry.setUser(null);
  }
}
