import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import RootNavigator from './src/navigation/RootNavigator';
import AppSplash from './src/components/AppSplash';
import { requestNotificationPermissions } from './src/utils/notifications';

export default function App() {
  const [ready, setReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    initApp();
  }, []);

  const initApp = async () => {
    try {
      await requestNotificationPermissions();
    } catch (err) {
      console.error('App init error:', err);
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
    <>
      <StatusBar style="dark" />
      <RootNavigator />
    </>
  );
}
