import React, { useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import OnboardingLayout from '../../components/OnboardingLayout';
import OptionCard from '../../components/OptionCard';
import { PrimaryGoal } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step5'>;
};

const GOAL_OPTIONS: {
  value: PrimaryGoal;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    value: 'lose_fast',
    label: 'Lose Weight Fast',
    description: 'Aggressive fat loss (~1.5 lbs/week)',
    icon: '🔥',
  },
  {
    value: 'lose_moderate',
    label: 'Steady Fat Loss',
    description: 'Sustainable weight loss (~1 lb/week)',
    icon: '📉',
  },
  {
    value: 'maintain',
    label: 'Recomp / Maintain',
    description: 'Build muscle while staying the same weight',
    icon: '⚖️',
  },
  {
    value: 'gain',
    label: 'Lean Bulk',
    description: 'Build muscle with minimal fat gain',
    icon: '💪',
  },
  {
    value: 'gain_fast',
    label: 'Gain Weight Fast',
    description: 'Maximize muscle & weight gain',
    icon: '📈',
  },
  {
    value: 'mobility',
    label: 'Mobility & Cardio',
    description: 'Focus on movement, flexibility, and endurance',
    icon: '🧘',
  },
];

export default function OnboardingStep5({ navigation }: Props) {
  const [goal, setGoal] = useState<PrimaryGoal | null>(null);

  const handleContinue = async () => {
    if (!goal) return;
    await saveOnboardingData({ primaryGoal: goal });
    navigation.navigate('Step6');
  };

  return (
    <OnboardingLayout
      step={5}
      totalSteps={10}
      title="What's your goal?"
      subtitle="Choose the goal that best matches your ambition"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={goal !== null}
    >
      {GOAL_OPTIONS.map((opt) => (
        <OptionCard
          key={opt.value}
          label={opt.label}
          description={opt.description}
          icon={opt.icon}
          selected={goal === opt.value}
          onPress={() => setGoal(opt.value)}
        />
      ))}
    </OnboardingLayout>
  );
}
