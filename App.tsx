import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

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
    } catch (err) {
      // Round 3: guard production builds — Metro strips __DEV__ at build time.
      if (__DEV__) console.error('App init error:', err);
    } finally {
      setReady(true);
    }
  };

  if (!ready || showSplash) {
    return (
      <>
        <AppSplash onFinish={() => setShowSplash(false)} />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <ErrorBoundary>
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
        <StatusBar style="dark" />
        <RootNavigator />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
