/**
 * LeanQ4MetricsScreen — sale-readiness completion.
 *
 * Captures the two essential body metrics (height, current weight) without
 * reintroducing the legacy 10-step onboarding. Both fields are optional —
 * the user can skip and capture them later from Profile. When provided,
 * values are persisted to AsyncStorage via the onboarding store and posted
 * with the rest of the onboarding payload at completion time.
 *
 * Units: imperial (lbs / ft+in) by default — matches the rest of the app.
 * Metric is computed locally if the device locale prefers it; the store
 * always saves height in cm and weight in kg so the backend stays canonical.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Localization from 'expo-localization';
import { LeanOnboardingParamList } from '../../navigation/LeanOnboardingNavigator';
import { Colors } from '../../constants/colors';
import { saveOnboardingData } from '../../utils/onboardingStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../../lib/analytics';
import { authEvents } from '../../utils/authEvents';

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ4'>;
};

// US uses imperial; everywhere else use metric.
function defaultUnits(): 'imperial' | 'metric' {
  try {
    const region = Localization.getLocales()[0]?.regionCode ?? 'US';
    return region === 'US' || region === 'LR' || region === 'MM'
      ? 'imperial'
      : 'metric';
  } catch {
    return 'imperial';
  }
}

function ftInToCm(ft: number, inches: number): number {
  const totalIn = ft * 12 + inches;
  return Math.round(totalIn * 2.54);
}

function lbsToKg(lbs: number): number {
  return Math.round(lbs * 0.45359237 * 10) / 10;
}

export default function LeanQ4MetricsScreen({ navigation }: Props) {
  const [units, setUnits] = useState<'imperial' | 'metric'>(defaultUnits());
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weight, setWeight] = useState(''); // lbs or kg depending on units
  const [submitting, setSubmitting] = useState(false);

  const isValid = useMemo(() => {
    if (units === 'imperial') {
      const ft = parseFloat(heightFt);
      const inches = parseFloat(heightIn || '0');
      const lbs = parseFloat(weight);
      // Allow either both height fields or just weight, but if any field is
      // touched it must be in a sane range. "Skip" is the route for empty.
      const heightOk =
        (!heightFt && !heightIn) ||
        (Number.isFinite(ft) && ft >= 3 && ft <= 8 && inches >= 0 && inches < 12);
      const weightOk =
        !weight || (Number.isFinite(lbs) && lbs >= 60 && lbs <= 700);
      return heightOk && weightOk;
    }
    const cm = parseFloat(heightCm);
    const kg = parseFloat(weight);
    const heightOk =
      !heightCm || (Number.isFinite(cm) && cm >= 90 && cm <= 250);
    const weightOk = !weight || (Number.isFinite(kg) && kg >= 30 && kg <= 320);
    return heightOk && weightOk;
  }, [units, heightFt, heightIn, heightCm, weight]);

  const finishOnboarding = async (skipped: boolean) => {
    setSubmitting(true);
    try {
      const payload: Parameters<typeof saveOnboardingData>[0] = {};
      if (units === 'imperial') {
        const ft = parseFloat(heightFt);
        const inches = parseFloat(heightIn || '0');
        if (Number.isFinite(ft) && ft >= 3) {
          payload.height = ftInToCm(ft, Number.isFinite(inches) ? inches : 0);
        }
        const lbs = parseFloat(weight);
        if (Number.isFinite(lbs) && lbs > 0) {
          payload.currentWeight = lbsToKg(lbs);
        }
      } else {
        const cm = parseFloat(heightCm);
        if (Number.isFinite(cm) && cm > 0) payload.height = Math.round(cm);
        const kg = parseFloat(weight);
        if (Number.isFinite(kg) && kg > 0) {
          payload.currentWeight = Math.round(kg * 10) / 10;
        }
      }
      if (Object.keys(payload).length > 0) {
        await saveOnboardingData(payload);
      }
      await AsyncStorage.setItem('onboarding_complete', 'true');
      await AsyncStorage.setItem('lean_onboarding_done', 'true');
      track(skipped ? 'onboarding_skipped' : 'onboarding_step_completed', {
        step: 4,
        captured_height: !!payload.height,
        captured_weight: !!payload.currentWeight,
      });
      authEvents.emit();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.stepIndicator}>
              <View style={[styles.dot, styles.dotComplete]} />
              <View style={[styles.dot, styles.dotComplete]} />
              <View style={[styles.dot, styles.dotComplete]} />
              <View style={[styles.dot, styles.dotActive]} />
            </View>
            <Text style={styles.headline}>A measure to begin.</Text>
            <Text style={styles.subtext}>
              These guide your targets. Add what you know — or skip and add later.
            </Text>
          </View>

          {/* Unit toggle */}
          <View style={styles.unitRow}>
            <TouchableOpacity
              style={[styles.unitChip, units === 'imperial' && styles.unitChipActive]}
              onPress={() => setUnits('imperial')}
              accessibilityRole="button"
              accessibilityLabel="Use imperial units"
              accessibilityState={{ selected: units === 'imperial' }}
            >
              <Text
                style={[
                  styles.unitChipText,
                  units === 'imperial' && styles.unitChipTextActive,
                ]}
              >
                ft / lbs
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.unitChip, units === 'metric' && styles.unitChipActive]}
              onPress={() => setUnits('metric')}
              accessibilityRole="button"
              accessibilityLabel="Use metric units"
              accessibilityState={{ selected: units === 'metric' }}
            >
              <Text
                style={[
                  styles.unitChipText,
                  units === 'metric' && styles.unitChipTextActive,
                ]}
              >
                cm / kg
              </Text>
            </TouchableOpacity>
          </View>

          {/* Height */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>HEIGHT</Text>
            {units === 'imperial' ? (
              <View style={styles.row2}>
                <TextInput
                  style={[styles.input, styles.inputHalf]}
                  value={heightFt}
                  onChangeText={setHeightFt}
                  placeholder="ft"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={1}
                  accessibilityLabel="Height in feet"
                />
                <TextInput
                  style={[styles.input, styles.inputHalf]}
                  value={heightIn}
                  onChangeText={setHeightIn}
                  placeholder="in"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel="Height in inches"
                />
              </View>
            ) : (
              <TextInput
                style={styles.input}
                value={heightCm}
                onChangeText={setHeightCm}
                placeholder="cm"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel="Height in centimetres"
              />
            )}
          </View>

          {/* Weight */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>CURRENT WEIGHT</Text>
            <TextInput
              style={styles.input}
              value={weight}
              onChangeText={setWeight}
              placeholder={units === 'imperial' ? 'lbs' : 'kg'}
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              maxLength={5}
              accessibilityLabel={
                units === 'imperial'
                  ? 'Current weight in pounds'
                  : 'Current weight in kilograms'
              }
            />
          </View>

          <View style={{ flex: 1 }} />

          {/* Save / skip */}
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (!isValid || submitting) && styles.primaryBtnDisabled,
            ]}
            onPress={() => finishOnboarding(false)}
            disabled={!isValid || submitting}
            accessibilityRole="button"
            accessibilityLabel="Save and continue"
          >
            <Text style={styles.primaryBtnText}>SAVE AND CONTINUE</Text>
          </TouchableOpacity>

          <View style={styles.bottomRow}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              activeOpacity={0.6}
              disabled={submitting}
            >
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => finishOnboarding(true)}
              style={styles.skipBtn}
              activeOpacity={0.6}
              disabled={submitting}
            >
              <Text style={styles.skipText}>Skip — I’ll add later</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  header: { marginBottom: 28 },
  stepIndicator: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.primary, width: 24 },
  dotComplete: { backgroundColor: Colors.primary },
  headline: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  unitRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  unitChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  unitChipActive: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(44, 74, 54, 0.04)',
  },
  unitChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
  },
  unitChipTextActive: { color: Colors.primary },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 1.98,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.textPrimary,
    fontFamily: 'Inter_400Regular',
  },
  row2: { flexDirection: 'row', gap: 12 },
  inputHalf: { flex: 1 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: Colors.textOnPrimary,
    letterSpacing: 1.2,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  backBtn: { paddingVertical: 12, paddingHorizontal: 4 },
  backText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 4 },
  skipText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
});
