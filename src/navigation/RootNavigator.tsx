import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import CoachNavigator from './CoachNavigator';
import OnboardingNavigator from './OnboardingNavigator';
import FloatingChatWidget from '../components/FloatingChatWidget';
import OfflineBanner from '../components/OfflineBanner';
import { authEvents } from '../utils/authEvents';
import { secureStorage } from '../services/secureStorage';
import { Colors } from '../constants/colors';
import { useNetworkStatus, isEffectivelyOnline } from '../hooks/useNetworkStatus';
import { flush as flushFoodLogQueue } from '../services/foodLogQueue';

type AuthState = 'loading' | 'unauthenticated' | 'onboarding' | 'coach' | 'student';

// Extract the active tab name from nested navigation state
function getActiveTabName(state: any): string | undefined {
  if (!state) return undefined;
  const route = state.routes?.[state.index];
  if (!route) return undefined;
  // If this route has nested state, recurse; otherwise return the name
  if (route.state) return getActiveTabName(route.state) ?? route.name;
  return route.name;
}

export default function RootNavigator() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const [activeRoute, setActiveRoute] = useState<string | undefined>();

  const onNavigationStateChange = useCallback(() => {
    const state = navigationRef.current?.getRootState();
    setActiveRoute(getActiveTabName(state));
  }, []);

  useEffect(() => {
    bootstrapAuth();
    const unsubscribe = authEvents.onAuthChange(bootstrapAuth);
    return unsubscribe;
  }, []);

  // Flush the offline food-log queue whenever the network comes back online.
  // Only fires on the offline → online transition; repeated online events are
  // no-ops because the queue is empty. Fire-and-forget; flush logs its own errors.
  const network = useNetworkStatus();
  const wasOnlineRef = useRef<boolean>(true);
  useEffect(() => {
    const online = isEffectivelyOnline(network);
    if (online && !wasOnlineRef.current) {
      flushFoodLogQueue().catch((err) => console.error('flushFoodLogQueue failed', err));
    }
    wasOnlineRef.current = online;
  }, [network.isOnline, network.isInternetReachable]);

  const bootstrapAuth = async () => {
    try {
      // secureStorage.getItem migrates any legacy AsyncStorage token into
      // SecureStore on first read, so existing users stay logged in.
      const token = await secureStorage.getItem('supabase_token');
      const userRaw = await AsyncStorage.getItem('user_data');
      const needsRoleSelection = await AsyncStorage.getItem('needs_role_selection');

      if (!token || !userRaw) {
        setAuthState('unauthenticated');
        return;
      }

      // Role selection not done yet — stay in auth flow
      if (needsRoleSelection === 'true') {
        setAuthState('unauthenticated');
        return;
      }

      let user = null;
      try {
        user = JSON.parse(userRaw);
      } catch {
        // Corrupted storage — treat as logged out
        await AsyncStorage.removeItem('user_data');
        setAuthState('unauthenticated');
        return;
      }
      const role = user?.role;

      if (role === 'coach') {
        setAuthState('coach');
        return;
      }

      if (role === 'student') {
        // Check if onboarding quiz has been completed
        const onboardingDone = await AsyncStorage.getItem('onboarding_complete');
        const profileDone = user?.profile?.onboarding_completed;

        if (onboardingDone !== 'true' && !profileDone) {
          setAuthState('onboarding');
          return;
        }

        // Sync: if backend says done but AsyncStorage doesn't, fix it
        if (profileDone && onboardingDone !== 'true') {
          await AsyncStorage.setItem('onboarding_complete', 'true');
        }

        setAuthState('student');
        return;
      }

      // Token exists but no role yet
      setAuthState('unauthenticated');
    } catch {
      setAuthState('unauthenticated');
    }
  };

  if (authState === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Hide the GP chat widget on Profile and Recipes screens
  const hideWidget = activeRoute === 'ProfileStack' || activeRoute === 'ProfileMain'
    || activeRoute === 'Settings' || activeRoute === 'Report'
    || activeRoute === 'Widgets' || activeRoute === 'Learn'
    || activeRoute === 'Recipes';

  return (
    <NavigationContainer ref={navigationRef} onStateChange={onNavigationStateChange}>
      {/* OfflineBanner sits at the top of every auth state so users see the
          offline indicator regardless of which navigator is mounted. */}
      <OfflineBanner />
      {authState === 'unauthenticated' ? (
        <AuthNavigator />
      ) : authState === 'onboarding' ? (
        <OnboardingNavigator />
      ) : authState === 'coach' ? (
        <CoachNavigator />
      ) : (
        <>
          <ClientNavigator />
          <FloatingChatWidget visible={!hideWidget} />
        </>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
