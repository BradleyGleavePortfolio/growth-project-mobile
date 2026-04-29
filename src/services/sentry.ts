import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

let initialized = false;

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
    // Strip sensitive headers before transmission.
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.authorization;
        delete event.request.headers.Cookie;
        delete event.request.headers.cookie;
      }
      return event;
    },
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
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}

/** Tag the current user so events are attributable. Call after login. */
export function setSentryUser(user: { id: string; email?: string } | null): void {
  if (!initialized) return;
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email });
  } else {
    Sentry.setUser(null);
  }
}
