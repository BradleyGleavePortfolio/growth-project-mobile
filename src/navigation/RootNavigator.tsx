import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import CoachNavigator from './CoachNavigator';
import OnboardingNavigator from './OnboardingNavigator';
import FloatingChatWidget from '../components/FloatingChatWidget';
import { authEvents } from '../utils/authEvents';
import { Colors } from '../constants/colors';

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

  const bootstrapAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('supabase_token');
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
