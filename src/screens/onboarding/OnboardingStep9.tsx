import React, { useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import OnboardingLayout from '../../components/OnboardingLayout';
import OptionCard from '../../components/OptionCard';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step9'>;
};

const FITNESS_LEVELS = [
  { value: 'beginner', label: 'Beginner', description: 'New to exercise or returning after a long break' },
  { value: 'intermediate', label: 'Intermediate', description: '6+ months consistent training' },
  { value: 'advanced', label: 'Advanced', description: '2+ years serious training' },
  { value: 'athlete', label: 'Athlete', description: 'Competitive or sport-specific training' },
];

export default function OnboardingStep9({ navigation }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!selected) return;
    await saveOnboardingData({ fitnessLevel: selected });
    navigation.navigate('Step10');
  };

  return (
    <OnboardingLayout
      step={9}
      totalSteps={10}
      title="Fitness Level"
      subtitle="Where are you in your fitness journey?"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={selected !== null}
    >
      {FITNESS_LEVELS.map((opt) => (
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
