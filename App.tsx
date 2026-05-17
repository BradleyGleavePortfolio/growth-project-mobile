import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { PostHogProvider } from 'posthog-react-native';
import {
  useFonts,
  CormorantGaramond_400Regular,
  CormorantGaramond_500Medium,
} from '@expo-google-fonts/cormorant-garamond';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import RootNavigator from './src/navigation/RootNavigator';
import AppSplash from './src/components/AppSplash';
import ErrorBoundary from './src/components/ErrorBoundary';
import { requestNotificationPermissions } from './src/utils/notifications';
// Phase 11: push-channel taxonomy — register Android channels + iOS categories
import { registerPushChannels } from './src/notifications/push-channels';
import { initDatabase } from './src/db/database';
import {
  queryClient,
  asyncStoragePersister,
  QUERY_CACHE_MAX_AGE,
} from './src/services/queryClient';
import { initSentry, wrap as sentryWrap } from './src/services/sentry';
// Phase 11: typed analytics service replaces the raw lib/analytics track call
// for app_opened so the typed AnalyticsEvents constant is used.
import { track } from './src/lib/analytics';
import { AnalyticsEvents } from './src/analytics/events';
import { ThemeProvider } from './src/theme/ThemeProvider';
import BiometricUnlockGate from './src/components/BiometricUnlockGate';

// Screenshots module — static import so Metro's resolver alias works correctly.
// In production EAS builds, metro.config.js resolveRequest hook redirects this
// import to src/screenshots/index.stub.ts (empty no-ops), so no fixture data
// or mock adapters ever reach the production bundle.
// In development and screenshot capture runs, the real module is used.
// Do NOT use a dynamic require() guarded by __DEV__ here — __DEV__ is a
// runtime constant and Metro cannot tree-shake dynamic requires at bundle time.
import { installAxiosMockAdapter, isScreenshotMode, seedDemoUser } from './src/screenshots';

// Initialise Sentry as early as possible so even import-time failures get
// captured. The function no-ops when EXPO_PUBLIC_SENTRY_DSN is unset, so this
// line is safe to commit without secrets.
initSentry();

// Screenshot mode: replace the axios network adapter with a fixture-backed one
// before any screen module imports `services/api`. No-op when the env flag is
// off, so production builds are unaffected.
installAxiosMockAdapter();

// Prevent the native splash from auto-hiding before fonts are ready.
// We hide it manually once fonts + app init are both complete.
SplashScreen.preventAutoHideAsync();

// PostHog credentials — loaded from Expo public env vars.
// EXPO_PUBLIC_POSTHOG_API_KEY is the canonical Phase 11 var name.
// EXPO_PUBLIC_POSTHOG_KEY is the legacy alias; both are accepted so existing
// dev setups without the rename continue to work.
// When both are absent (CI, local dev without secrets) the SDK no-ops.
const POSTHOG_KEY =
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY ??
  process.env.EXPO_PUBLIC_POSTHOG_KEY ??
  '';
const POSTHOG_HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';

// In screenshot mode the PostHog provider is bypassed: posthog-react-native's
// web shim throws on construct in some envs, and analytics has no place in a
// capture run anyway. Production path is unchanged.
const AnalyticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  isScreenshotMode() ? (
    <>{children}</>
  ) : (
    <PostHogProvider
      apiKey={POSTHOG_KEY}
      options={{ host: POSTHOG_HOST }}
      autocapture
    >
      {children}
    </PostHogProvider>
  );

function App() {
  const [ready, setReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  // Wave 2: Load Cormorant Garamond (display serif) + Inter (neutral sans).
  // Open-source fallback pair for GT Sectra + Söhne (commercial).
  const [fontsLoaded] = useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_500Medium,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // Hide native splash once fonts are loaded.
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    initApp();
  }, []);

  const initApp = async () => {
    try {
      if (isScreenshotMode()) {
        // Skip notification permission prompts and analytics in screenshot
        // mode — both can throw modal UI on top of the screen we are trying
        // to capture. Seed AsyncStorage so RootNavigator routes the demo user
        // straight into ClientNavigator. The local SQLite database is also
        // skipped: none of the marketing-target screens (Home / Log / Plan /
        // Recipes / Progress / Fast) read from it, and the web build of
        // expo-sqlite needs cross-origin-isolation that the dev server does
        // not set, which would hang the boot.
        await seedDemoUser();
      } else {
        // Initialize SQLite database: create tables, seed exercises (152),
        // recipes, foods, lessons, community data, etc.
        // NOTE: seedCoachIfNeeded() was removed along with the dead SQLite auth path.
        // Auth lives exclusively on the backend now; the local `users` table is no longer used.
        await initDatabase();
        // Phase 11: register push channels BEFORE requesting permission so
        // Android channels are configured before the system prompt fires.
        await registerPushChannels();
        await requestNotificationPermissions();
        // Phase 11: use typed AnalyticsEvents constant for app_opened.
        track(AnalyticsEvents.APP_OPENED, { cold_start: true });
      }
    } catch (err) {
      // Round 3: guard production builds — Metro strips __DEV__ at build time.
      if (__DEV__) console.error('App init error:', err);
    } finally {
      setReady(true);
    }
  };

  // Block render until fonts are loaded — prevents flash of unstyled text.
  // The native splash screen remains visible during this window (preventAutoHideAsync above).
  if (!fontsLoaded) {
    return null;
  }

  if (!ready || (showSplash && !isScreenshotMode())) {
    // Screenshot mode bypasses the AppSplash animation so captures land on
    // real content immediately rather than the bone splash card.
    return (
      <>
        <AppSplash onFinish={() => setShowSplash(false)} />
        <StatusBar style="dark" backgroundColor="#F5EFE4" />
      </>
    );
  }

  return (
    <ErrorBoundary>
      {/*
        PostHogProvider wraps the whole app so the SDK can auto-capture
        screen views and session recording (when enabled). autocapture is
        enabled so screen transitions are tracked automatically. It no-ops
        when POSTHOG_KEY is an empty string, so no secrets are needed in dev.
      */}
      <AnalyticsProvider>
        {/*
          PersistQueryClientProvider wraps the whole app so any screen migrated
          to API-first (Fix #2) can use useQuery/useMutation. We use the
          persisting variant so the React Query cache is hydrated from
          AsyncStorage on cold start — a user opening the app sees last-known
          data immediately while a fresh fetch runs in the background, instead
          of staring at a spinner. The provider is intentionally INSIDE
          ErrorBoundary so a thrown query error from a single screen doesn't
          take down the rest of the app — the boundary will catch it, and
          React Query will retry on the next mount.
        */}
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: asyncStoragePersister,
            maxAge: QUERY_CACHE_MAX_AGE,
            // Bump this string whenever the wire shape of any cached query
            // changes incompatibly. Cache entries with a different buster are
            // discarded on hydration instead of being deserialized into
            // mismatched TypeScript types.
            buster: 'tgp-rq-v1',
            dehydrateOptions: {
              // Don't persist transient or per-session-only queries. Anything
              // tagged with the meta { persist: false } (none today, but future
              // mutations-in-progress proxies will be) gets evicted before write.
              shouldDehydrateQuery: (q) => q.meta?.persist !== false,
            },
          }}
        >
          {/* Wave 2: dark status bar on bone background */}
          <StatusBar style="dark" backgroundColor="#F5EFE4" />
          {/* ThemeProvider: Premium Visual System — UX Psych Report #5.
              Must be inside PersistQueryClientProvider so useFoundingNumber()
              (which calls useQuery) works correctly. */}
          <ThemeProvider>
            {/* BiometricUnlockGate is a no-op when the user hasn't opted in.
                It sits inside ThemeProvider so the locked-state UI uses the
                same theme as the rest of the app. */}
            <BiometricUnlockGate>
              <RootNavigator />
            </BiometricUnlockGate>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </AnalyticsProvider>
    </ErrorBoundary>
  );
}

// Sentry.wrap() injects an automatic error boundary + touch tracking. When
// the SDK isn't initialised (no DSN) it returns the component unchanged.
export default sentryWrap(App);