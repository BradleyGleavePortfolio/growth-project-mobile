/**
 * LeanOnboardingNavigator — Psych Report #1 "Activation-First Dopamine"
 *
 * Replaces the 10-step wizard with 3 essential questions + immediate payoff.
 * Target: time-to-first-win < 60 seconds.
 *
 * Old OnboardingNavigator (10 steps) is kept intact and untouched.
 * RootNavigator routes `hasOnboarded === false` students to THIS navigator.
 *
 * Q4 no longer finalizes — it navigates to Q5. Q6 is the true terminal step
 * and owns finalizeLeanOnboarding() + authEvents.emit().
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LeanQ1GoalScreen from '../screens/onboarding/LeanQ1GoalScreen';
import LeanQ2ExperienceScreen from '../screens/onboarding/LeanQ2ExperienceScreen';
import LeanQ3IntentScreen from '../screens/onboarding/LeanQ3IntentScreen';
import LeanQ4MetricsScreen from '../screens/onboarding/LeanQ4MetricsScreen';
import LeanQ5Screen from '../screens/onboarding/LeanQ5Screen';
import LeanQ6Screen from '../screens/onboarding/LeanQ6Screen';

export type LeanOnboardingParamList = {
  LeanQ1: undefined;
  LeanQ2: undefined;
  LeanQ3: undefined;
  LeanQ4: undefined;
  LeanQ5: undefined;
  LeanQ6: undefined;
};

const Stack = createNativeStackNavigator<LeanOnboardingParamList>();

export default function LeanOnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="LeanQ1" component={LeanQ1GoalScreen} />
      <Stack.Screen name="LeanQ2" component={LeanQ2ExperienceScreen} />
      <Stack.Screen name="LeanQ3" component={LeanQ3IntentScreen} />
      <Stack.Screen name="LeanQ4" component={LeanQ4MetricsScreen} />
      <Stack.Screen name="LeanQ5" component={LeanQ5Screen} />
      <Stack.Screen name="LeanQ6" component={LeanQ6Screen} />
    </Stack.Navigator>
  );
}
