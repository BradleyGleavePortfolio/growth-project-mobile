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
import { feetInchesToCm } from '../../utils/nutrition';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step2'>;
};

export default function OnboardingStep2({ navigation }: Props) {
  const [weightUnit, setWeightUnit] = useState<'lbs' | 'kg'>('lbs');
  const [heightUnit, setHeightUnit] = useState<'imperial' | 'metric'>('imperial');
  const [currentWeight, setCurrentWeight] = useState('');
  const [goalWeight, setGoalWeight] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [cm, setCm] = useState('');

  const canContinue = !!(
    currentWeight.trim() &&
    goalWeight.trim() &&
    (heightUnit === 'imperial' ? feet.trim() : cm.trim())
  );

  const handleContinue = async () => {
    if (!canContinue) return;

    let weightLbs = parseFloat(currentWeight);
    let goalLbs = parseFloat(goalWeight);
    if (weightUnit === 'kg') {
      weightLbs = weightLbs * 2.20462;
      goalLbs = goalLbs * 2.20462;
    }

    let heightCm: number;
    if (heightUnit === 'imperial') {
      heightCm = feetInchesToCm(parseInt(feet) || 0, parseInt(inches) || 0);
    } else {
      heightCm = parseFloat(cm);
    }

    await saveOnboardingData({
      currentWeight: Math.round(weightLbs),
      targetWeight: Math.round(goalLbs),
      height: Math.round(heightCm * 10) / 10,
    });

    navigation.navigate('Step3');
  };

  return (
    <OnboardingLayout
      step={2}
      totalSteps={10}
      title="Body Metrics"
      subtitle="We'll use this to calculate your targets"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={canContinue}
    >
      <View style={styles.unitToggle}>
        <TouchableOpacity
          style={[styles.unitButton, weightUnit === 'lbs' && styles.unitButtonActive]}
          onPress={() => setWeightUnit('lbs')}
        >
          <Text style={[styles.unitText, weightUnit === 'lbs' && styles.unitTextActive]}>lbs</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.unitButton, weightUnit === 'kg' && styles.unitButtonActive]}
          onPress={() => setWeightUnit('kg')}
        >
          <Text style={[styles.unitText, weightUnit === 'kg' && styles.unitTextActive]}>kg</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Current Weight ({weightUnit})</Text>
        <TextInput
          style={styles.input}
          value={currentWeight}
          onChangeText={setCurrentWeight}
          placeholder={`Weight in ${weightUnit}`}
          placeholderTextColor={Colors.textMuted}
          keyboardType="numeric"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Goal Weight ({weightUnit})</Text>
        <TextInput
          style={styles.input}
          value={goalWeight}
          onChangeText={setGoalWeight}
          placeholder={`Goal weight in ${weightUnit}`}
          placeholderTextColor={Colors.textMuted}
          keyboardType="numeric"
        />
      </View>

      <View style={[styles.unitToggle, { marginTop: 8 }]}>
        <TouchableOpacity
          style={[styles.unitButton, heightUnit === 'imperial' && styles.unitButtonActive]}
          onPress={() => setHeightUnit('imperial')}
        >
          <Text style={[styles.unitText, heightUnit === 'imperial' && styles.unitTextActive]}>ft / in</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.unitButton, heightUnit === 'metric' && styles.unitButtonActive]}
          onPress={() => setHeightUnit('metric')}
        >
          <Text style={[styles.unitText, heightUnit === 'metric' && styles.unitTextActive]}>cm</Text>
        </TouchableOpacity>
      </View>

      {heightUnit === 'imperial' ? (
        <View style={styles.row}>
          <View style={[styles.inputContainer, { flex: 1 }]}>
            <Text style={styles.label}>Feet</Text>
            <TextInput
              style={styles.input}
              value={feet}
              onChangeText={setFeet}
              placeholder="5"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
            />
          </View>
          <View style={[styles.inputContainer, { flex: 1 }]}>
            <Text style={styles.label}>Inches</Text>
            <TextInput
              style={styles.input}
              value={inches}
              onChangeText={setInches}
              placeholder="10"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
            />
          </View>
        </View>
      ) : (
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Height (cm)</Text>
          <TextInput
            style={styles.input}
            value={cm}
            onChangeText={setCm}
            placeholder="175"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
          />
        </View>
      )}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 3,
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  unitButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 0, // radius.sm
  },
  unitButtonActive: {
    backgroundColor: Colors.primary,
  },
  unitText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  unitTextActive: {
    color: Colors.textOnPrimary,
  },
  inputContainer: {
    marginBottom: 20,
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
    fontSize: 16,
    color: Colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
});
