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
import { initDatabase } from './src/db/database';
import {
  queryClient,
  asyncStoragePersister,
  QUERY_CACHE_MAX_AGE,
} from './src/services/queryClient';
import { initSentry, wrap as sentryWrap } from './src/services/sentry';
import { track } from './src/lib/analytics';
import { ThemeProvider } from './src/theme/ThemeProvider';

// Initialise Sentry as early as possible so even import-time failures get
// captured. The function no-ops when EXPO_PUBLIC_SENTRY_DSN is unset, so this
// line is safe to commit without secrets.
initSentry();

// Prevent the native splash from auto-hiding before fonts are ready.
// We hide it manually once fonts + app init are both complete.
SplashScreen.preventAutoHideAsync();

// PostHog credentials — loaded from Expo public env vars.
// When the key is absent (CI, local dev without secrets) the SDK no-ops.
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const POSTHOG_HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

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
      // Initialize SQLite database: create tables, seed exercises (152),
      // recipes, foods, lessons, community data, etc.
      // NOTE: seedCoachIfNeeded() was removed along with the dead SQLite auth path.
      // Auth lives exclusively on the backend now; the local `users` table is no longer used.
      await initDatabase();
      await requestNotificationPermissions();
      // Psych Report #4: Analytics — fire app_opened on every cold start.
      track('app_opened');
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

  if (!ready || showSplash) {
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
        screen views and session recording (when enabled). It no-ops when
        POSTHOG_KEY is an empty string, so no secrets are needed in dev.
      */}
      <PostHogProvider
        apiKey={POSTHOG_KEY}
        options={{ host: POSTHOG_HOST }}
      >
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
            <RootNavigator />
          </ThemeProvider>
        </PersistQueryClientProvider>
      </PostHogProvider>
    </ErrorBoundary>
  );
}

// Sentry.wrap() injects an automatic error boundary + touch tracking. When
// the SDK isn't initialised (no DSN) it returns the component unchanged.
export default sentryWrap(App);
