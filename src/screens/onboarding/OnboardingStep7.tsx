import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { useAuthStore } from '../../store/authStore';
import { updateProfile, getProfileByUserId } from '../../db/profileDb';
import OnboardingLayout from '../../components/OnboardingLayout';
import OptionCard from '../../components/OptionCard';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step7'>;
};

const TIMELINE_OPTIONS = [
  { weeks: 4, label: '4 Weeks', description: 'Quick start sprint' },
  { weeks: 8, label: '8 Weeks', description: 'Standard transformation' },
  { weeks: 12, label: '12 Weeks', description: 'Recommended for most goals' },
  { weeks: 16, label: '16 Weeks', description: 'Deep body recomposition' },
  { weeks: 24, label: '24 Weeks', description: 'Long-term lifestyle change' },
];

export default function OnboardingStep7({ navigation }: Props) {
  const { currentUser } = useAuthStore();
  const [timeline, setTimeline] = useState<number | null>(null);

  const profile = useAuthStore.getState().clientProfile;
  const currentWeight = profile?.currentWeight || 180;
  const targetWeight = profile?.targetWeight || 170;
  const weeklyChange =
    timeline && timeline > 0
      ? ((targetWeight - currentWeight) / timeline).toFixed(1)
      : null;

  const handleContinue = async () => {
    if (!timeline || !currentUser) return;
    await updateProfile(currentUser.id, { timeline });
    navigation.navigate('Step8');
  };

  return (
    <OnboardingLayout
      step={7}
      totalSteps={10}
      title="Pick Your Timeline"
      subtitle="How long do you want to commit?"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={timeline !== null}
    >
      {TIMELINE_OPTIONS.map((opt) => (
        <OptionCard
          key={opt.weeks}
          label={opt.label}
          description={opt.description}
          selected={timeline === opt.weeks}
          onPress={() => setTimeline(opt.weeks)}
        />
      ))}

      {timeline && weeklyChange ? (
        <View style={styles.projectionCard}>
          <Text style={styles.projectionTitle}>Projected Progress</Text>
          <View style={styles.projectionRow}>
            <View style={styles.projectionItem}>
              <Text style={styles.projectionValue}>{currentWeight}</Text>
              <Text style={styles.projectionLabel}>Current (lbs)</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
            <View style={styles.projectionItem}>
              <Text style={[styles.projectionValue, { color: Colors.primary }]}>
                {targetWeight}
              </Text>
              <Text style={styles.projectionLabel}>Goal (lbs)</Text>
            </View>
          </View>
          <Text style={styles.weeklyRate}>
            ~{Math.abs(parseFloat(weeklyChange))} lbs/week over {timeline} weeks
          </Text>
        </View>
      ) : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  projectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 20,
    marginTop: 24,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  projectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  projectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  projectionItem: {
    alignItems: 'center',
    gap: 4,
  },
  projectionValue: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  projectionLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  arrow: {
    fontSize: 24,
    color: Colors.textMuted,
  },
  weeklyRate: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
});
