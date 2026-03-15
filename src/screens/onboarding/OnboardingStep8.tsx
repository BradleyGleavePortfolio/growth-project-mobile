import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { useAuthStore } from '../../store/authStore';
import { updateProfile } from '../../db/profileDb';
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
  const { currentUser } = useAuthStore();
  const [selected, setSelected] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!selected || !currentUser) return;
    await updateProfile(currentUser.id, { gymMembership: selected as any });
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
