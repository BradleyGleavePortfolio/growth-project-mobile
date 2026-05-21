/**
 * Day1OnboardingNavigator — the final Day-1 first-run experience.
 *
 * Stack order (matches the 1/6 → 6/6 progress bar; Welcome is the cover):
 *   Welcome → CoachPairing → Goals → Notifications → CheckInTime → Ready
 *
 * Deep-link path: when the universal-link handler captures an invite code,
 * RootNavigator pushes this navigator with `initialParams={{ prefillCode }}`
 * on the CoachPairing screen and `initialRouteName="CoachPairing"`. From a
 * cold start with no pending invite, the user opens at Welcome.
 *
 * Resume: if a previous run wrote a checkpoint to AsyncStorage (force-close
 * or "Continue offline" branch), we jump straight to the saved step instead
 * of restarting from Welcome. Read happens in the gating component below so
 * the navigator never mounts with stale or missing state.
 *
 * The Ready screen owns the terminal POST that flips `day_one_completed`
 * and emits authEvents — RootNavigator listens for that and re-renders
 * the authenticated tab stack.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen from '../screens/day-one/WelcomeScreen';
import CoachPairingScreen from '../screens/day-one/CoachPairingScreen';
import GoalsScreen from '../screens/day-one/GoalsScreen';
import NotificationsScreen from '../screens/day-one/NotificationsScreen';
import CheckInTimeScreen from '../screens/day-one/CheckInTimeScreen';
import ReadyScreen from '../screens/day-one/ReadyScreen';
import {
  readResumeState,
  type DayOneStepName,
} from '../screens/day-one/resume';
import { useTheme } from '../theme/ThemeProvider';

export type Day1OnboardingParamList = {
  Welcome: undefined;
  CoachPairing: { prefillCode?: string } | undefined;
  Goals: undefined;
  Notifications: undefined;
  CheckInTime: undefined;
  Ready: undefined;
};

const Stack = createNativeStackNavigator<Day1OnboardingParamList>();

interface Props {
  /** Optional deep-link prefill — when set, opens at CoachPairing with code. */
  initialPrefillCode?: string;
}

export default function Day1OnboardingNavigator({ initialPrefillCode }: Props = {}) {
  const { colors } = useTheme();
  const [initialRoute, setInitialRoute] = useState<DayOneStepName | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialPrefillCode) {
        if (!cancelled) setInitialRoute('CoachPairing');
        return;
      }
      const state = await readResumeState();
      if (cancelled) return;
      // Don't resume into Ready — that screen owns the terminal POST and
      // re-running it on every boot would loop a finished user.
      setInitialRoute(state && state.step !== 'Ready' ? state.step : 'Welcome');
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPrefillCode]);

  if (!initialRoute) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen
        name="CoachPairing"
        component={CoachPairingScreen}
        initialParams={
          initialPrefillCode ? { prefillCode: initialPrefillCode } : undefined
        }
      />
      <Stack.Screen name="Goals" component={GoalsScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="CheckInTime" component={CheckInTimeScreen} />
      <Stack.Screen
        name="Ready"
        component={ReadyScreen}
        options={{ animation: 'fade', gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
