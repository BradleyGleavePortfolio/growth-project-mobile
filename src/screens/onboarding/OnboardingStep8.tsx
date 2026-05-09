/**
 * @deprecated  Kept for reference. The active onboarding flow is the lean
 *              4-question wizard at `src/screens/onboarding/LeanQ1–Q4*`.
 *
 * Why this file is still in the tree
 * ──────────────────────────────────
 * The `OnboardingNavigator` that mounts these screens is no longer
 * routed in `RootNavigator` (see the `authState === 'onboarding'` branch
 * — it renders `LeanOnboardingNavigator`). We keep the file because
 * `OnboardingResults.handleStart` is the reference implementation for
 * the lean→backend wiring (`finalizeLeanOnboarding`). Delete only after
 * the lean flow has shipped to TestFlight, the reconcile hook is proven
 * stable, and the legacy field-by-field semantics are no longer needed.
 */
import React, { useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import OnboardingLayout from '../../components/OnboardingLayout';
import OptionCard from '../../components/OptionCard';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step8'>;
};

const GYM_OPTIONS = [
  { value: 'yes_regular', label: 'Yes — I go regularly', description: '3+ times per week' },
  { value: 'yes_occasional', label: 'Yes — occasionally', description: '1-2 times per week' },
  { value: 'home_gym', label: 'Home gym setup', description: 'I work out at home' },
  { value: 'no_gym', label: 'No gym membership', description: 'Bodyweight / outdoor only' },
];

export default function OnboardingStep8({ navigation }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!selected) return;
    await saveOnboardingData({ gymMembership: selected });
    navigation.navigate('Step9');
  };

  return (
    <OnboardingLayout
      step={8}
      totalSteps={10}
      title="Gym Access"
      subtitle="Do you have a gym membership?"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={selected !== null}
    >
      {GYM_OPTIONS.map((opt) => (
        <OptionCard
          key={opt.value}
          label={opt.label}
          description={opt.description}
          selected={selected === opt.value}
          onPress={() => setSelected(opt.value)}
        />
      ))}
    </OnboardingLayout>
  );
}
