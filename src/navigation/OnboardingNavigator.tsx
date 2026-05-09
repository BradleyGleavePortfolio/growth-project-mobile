/**
 * @deprecated  Kept for reference. The active onboarding stack is
 *              `LeanOnboardingNavigator`. `RootNavigator` no longer
 *              mounts this navigator for any auth state; this file is
 *              imported only so the legacy tree compiles. The
 *              `OnboardingStep1..10` + `OnboardingResults` screens it
 *              registers carry the canonical `profileApi.update` wiring
 *              that `lib/finalizeLeanOnboarding.ts` was modeled on. Do
 *              NOT delete until the lean flow has shipped to TestFlight,
 *              the reconcile hook is stable, and the field-by-field
 *              semantics are no longer needed for reference.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingStep1 from '../screens/onboarding/OnboardingStep1';
import OnboardingStep2 from '../screens/onboarding/OnboardingStep2';
import OnboardingStep3 from '../screens/onboarding/OnboardingStep3';
import OnboardingStep4 from '../screens/onboarding/OnboardingStep4';
import OnboardingStep5 from '../screens/onboarding/OnboardingStep5';
import OnboardingStep6 from '../screens/onboarding/OnboardingStep6';
import OnboardingStep7 from '../screens/onboarding/OnboardingStep7';
import OnboardingStep8 from '../screens/onboarding/OnboardingStep8';
import OnboardingStep9 from '../screens/onboarding/OnboardingStep9';
import OnboardingStep10 from '../screens/onboarding/OnboardingStep10';
import OnboardingResults from '../screens/onboarding/OnboardingResults';
import { Colors } from '../constants/colors';

export type OnboardingStackParamList = {
  Step1: undefined;
  Step2: undefined;
  Step3: undefined;
  Step4: undefined;
  Step5: undefined;
  Step6: undefined;
  Step7: undefined;
  Step8: undefined;
  Step9: undefined;
  Step10: undefined;
  Results: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export default function OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="Step1" component={OnboardingStep1} />
      <Stack.Screen name="Step2" component={OnboardingStep2} />
      <Stack.Screen name="Step3" component={OnboardingStep3} />
      <Stack.Screen name="Step4" component={OnboardingStep4} />
      <Stack.Screen name="Step5" component={OnboardingStep5} />
      <Stack.Screen name="Step6" component={OnboardingStep6} />
      <Stack.Screen name="Step7" component={OnboardingStep7} />
      <Stack.Screen name="Step8" component={OnboardingStep8} />
      <Stack.Screen name="Step9" component={OnboardingStep9} />
      <Stack.Screen name="Step10" component={OnboardingStep10} />
      <Stack.Screen name="Results" component={OnboardingResults} />
    </Stack.Navigator>
  );
}
