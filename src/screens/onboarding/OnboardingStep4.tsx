import React, { useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { useAuthStore } from '../../store/authStore';
import { updateProfile } from '../../db/profileDb';
import OnboardingLayout from '../../components/OnboardingLayout';
import OptionCard from '../../components/OptionCard';
import { ActivityLevel } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step4'>;
};

const ACTIVITY_OPTIONS: {
  value: ActivityLevel;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    value: 'sedentary',
    label: 'Sedentary',
    description: 'Little or no exercise, desk job',
    icon: '🪑',
  },
  {
    value: 'light',
    label: 'Lightly Active',
    description: 'Light exercise 1-3 days/week',
    icon: '🚶',
  },
  {
    value: 'moderate',
    label: 'Moderately Active',
    description: 'Moderate exercise 3-5 days/week',
    icon: '🏃',
  },
  {
    value: 'active',
    label: 'Very Active',
    description: 'Hard exercise 6-7 days/week',
    icon: '🏋️',
  },
  {
    value: 'very_active',
    label: 'Athlete',
    description: 'Very hard exercise, physical job, or 2x/day training',
    icon: '⚡',
  },
];

export default function OnboardingStep4({ navigation }: Props) {
  const { currentUser } = useAuthStore();
  const [activity, setActivity] = useState<ActivityLevel | null>(null);

  const handleContinue = async () => {
    if (!activity || !currentUser) return;
    await updateProfile(currentUser.id, { activityLevel: activity });
    navigation.navigate('Step5');
  };

  return (
    <OnboardingLayout
      step={4}
      totalSteps={10}
      title="Activity Level"
      subtitle="How active are you on a typical week?"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={activity !== null}
    >
      {ACTIVITY_OPTIONS.map((opt) => (
        <OptionCard
          key={opt.value}
          label={opt.label}
          description={opt.description}
          icon={opt.icon}
          selected={activity === opt.value}
          onPress={() => setActivity(opt.value)}
        />
      ))}
    </OnboardingLayout>
  );
}
