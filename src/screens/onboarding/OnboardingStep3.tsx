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
import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import OnboardingLayout from '../../components/OnboardingLayout';
import { calculateAge } from '../../utils/nutrition';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step3'>;
};

export default function OnboardingStep3({ navigation }: Props) {
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');

  const dob = useMemo(() => {
    if (!year || !month || !day) return null;
    const y = parseInt(year);
    const m = parseInt(month);
    const d = parseInt(day);
    if (y < 1920 || y > 2015 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }, [year, month, day]);

  const age = dob ? calculateAge(dob) : null;
  const canContinue = dob !== null && age !== null && age >= 13 && age <= 100;

  const handleContinue = async () => {
    if (!canContinue || !dob) return;
    await saveOnboardingData({ dob });
    navigation.navigate('Step4');
  };

  return (
    <OnboardingLayout
      step={3}
      totalSteps={10}
      title="How old are you?"
      subtitle="Enter your date of birth"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={canContinue}
    >
      <View style={styles.row}>
        <View style={[styles.inputContainer, { flex: 1 }]}>
          <Text style={styles.label}>Month</Text>
          <TextInput
            style={styles.input}
            value={month}
            onChangeText={setMonth}
            placeholder="MM"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            maxLength={2}
          />
        </View>
        <View style={[styles.inputContainer, { flex: 1 }]}>
          <Text style={styles.label}>Day</Text>
          <TextInput
            style={styles.input}
            value={day}
            onChangeText={setDay}
            placeholder="DD"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            maxLength={2}
          />
        </View>
        <View style={[styles.inputContainer, { flex: 1.5 }]}>
          <Text style={styles.label}>Year</Text>
          <TextInput
            style={styles.input}
            value={year}
            onChangeText={setYear}
            placeholder="YYYY"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            maxLength={4}
          />
        </View>
      </View>

      {age !== null && age >= 13 && age <= 100 ? (
        <View style={styles.ageDisplay}>
          <Text style={styles.ageNumber}>{age}</Text>
          <Text style={styles.ageLabel}>years old</Text>
        </View>
      ) : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 2, // radius.md
    padding: 16,
    fontSize: 18,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  ageDisplay: {
    alignItems: 'center',
    marginTop: 40,
    gap: 4,
  },
  ageNumber: {
    fontSize: 64,
    fontWeight: '500',
    color: Colors.primary,
  },
  ageLabel: {
    fontSize: 18,
    color: Colors.textSecondary,
  },
});
