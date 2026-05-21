/**
 * Day1OnboardingNavigator — the final Day-1 first-run experience.
 *
 * Stack order (matches the progress bar 1/5 → 5/5; Welcome is the cover):
 *   Welcome → CoachPairing → Goals → Notifications → CheckInTime → Ready
 *
 * Deep-link path: when the universal-link handler captures an invite code,
 * RootNavigator pushes this navigator with `initialParams={{ prefillCode }}`
 * on the CoachPairing screen and `initialRouteName="CoachPairing"`. From a
 * cold start with no pending invite, the user opens at Welcome.
 *
 * The Ready screen owns the terminal POST that flips `day_one_completed`
 * and emits authEvents — RootNavigator listens for that and re-renders
 * the authenticated tab stack.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen from '../screens/day-one/WelcomeScreen';
import CoachPairingScreen from '../screens/day-one/CoachPairingScreen';
import GoalsScreen from '../screens/day-one/GoalsScreen';
import NotificationsScreen from '../screens/day-one/NotificationsScreen';
import CheckInTimeScreen from '../screens/day-one/CheckInTimeScreen';
import ReadyScreen from '../screens/day-one/ReadyScreen';

export type Day1OnboardingParamList = {
  Welcome: undefined;
  CoachPairing: { prefillCode?: string } | undefined;
  Goals: undefined;
  Notifications: undefined;
  CheckInTime: undefined;
  Ready: undefined;
};

const Stack = createNativeStackNavigator<Day1OnboardingParamList>();

export default function Day1OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="CoachPairing" component={CoachPairingScreen} />
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
