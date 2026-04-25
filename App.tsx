import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from './src/navigation/RootNavigator';
import AppSplash from './src/components/AppSplash';
import ErrorBoundary from './src/components/ErrorBoundary';
import { requestNotificationPermissions } from './src/utils/notifications';
import { initDatabase } from './src/db/database';
import { queryClient } from './src/services/queryClient';

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
        QueryClientProvider wraps the whole app so any screen migrated to
        API-first (Fix #2) can use useQuery/useMutation. The provider is
        intentionally INSIDE ErrorBoundary so a thrown query error from a
        single screen doesn't take down the rest of the app — the boundary
        will catch it, and React Query will retry on the next mount.
      */}
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <RootNavigator />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
