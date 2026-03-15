import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AuthNavigator from './AuthNavigator';
import ClientNavigator from './ClientNavigator';
import CoachNavigator from './CoachNavigator';
import FloatingChatWidget from '../components/FloatingChatWidget';
import { authEvents } from '../utils/authEvents';
import { Colors } from '../constants/colors';

type AuthState = 'loading' | 'unauthenticated' | 'coach' | 'student';

export default function RootNavigator() {
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    bootstrapAuth();
    // Re-check auth whenever a login/register screen fires the event
    const unsubscribe = authEvents.onAuthChange(bootstrapAuth);
    return unsubscribe;
  }, []);

  const bootstrapAuth = async () => {
    try {
      const token = await AsyncStorage.getItem('supabase_token');
      const userRaw = await AsyncStorage.getItem('user_data');

      if (!token || !userRaw) {
        setAuthState('unauthenticated');
        return;
      }

      const user = JSON.parse(userRaw);
      const role = user?.role;

      if (role === 'coach') {
        setAuthState('coach');
      } else if (role === 'student') {
        setAuthState('student');
      } else {
        // Token exists but role not set yet — show auth (role selection)
        setAuthState('unauthenticated');
      }
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

  return (
    <NavigationContainer>
      {authState === 'unauthenticated' ? (
        <AuthNavigator />
      ) : authState === 'coach' ? (
        <CoachNavigator />
      ) : (
        <>
          <ClientNavigator />
          <FloatingChatWidget />
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
