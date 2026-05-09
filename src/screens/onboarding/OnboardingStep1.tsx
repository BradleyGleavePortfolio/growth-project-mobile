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
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import OnboardingLayout from '../../components/OnboardingLayout';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step1'>;
};

export default function OnboardingStep1({ navigation }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | null>(null);

  const canContinue = !!(firstName.trim() && lastName.trim() && sex !== null);

  const handleContinue = async () => {
    if (!canContinue) return;
    await saveOnboardingData({ firstName, lastName, sex: sex! });
    navigation.navigate('Step2');
  };

  return (
    <OnboardingLayout
      step={1}
      totalSteps={10}
      title="Let's get to know you"
      subtitle="Tell us about yourself"
      onContinue={handleContinue}
      continueEnabled={canContinue}
    >
      <View style={styles.inputContainer}>
        <Text style={styles.label}>First Name</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First name"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Last Name</Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last name"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="words"
        />
      </View>

      <Text style={styles.label}>Biological Sex</Text>
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleCard, sex === 'male' && styles.toggleCardActive]}
          onPress={() => setSex('male')}
          activeOpacity={0.7}
        >
          <Text style={styles.toggleIcon}>♂</Text>
          <Text style={[styles.toggleText, sex === 'male' && styles.toggleTextActive]}>
            Male
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleCard, sex === 'female' && styles.toggleCardActive]}
          onPress={() => setSex('female')}
          activeOpacity={0.7}
        >
          <Text style={styles.toggleIcon}>♀</Text>
          <Text style={[styles.toggleText, sex === 'female' && styles.toggleTextActive]}>
            Female
          </Text>
        </TouchableOpacity>
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    marginBottom: 20,
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 2, // radius.md
    padding: 16,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 4, // radius.lg
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  toggleCardActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(45, 106, 79, 0.08)',
  },
  toggleIcon: {
    fontSize: 32,
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  toggleTextActive: {
    color: Colors.primary,
  },
});
