/**
 * LeanQ2ExperienceScreen — Psych Report #1 "Activation-First Dopamine"
 * Q2: Experience level — new / some / experienced
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LeanOnboardingParamList } from '../../navigation/LeanOnboardingNavigator';

import { saveOnboardingData } from '../../utils/onboardingStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../../lib/analytics';
import { authEvents } from '../../utils/authEvents';
import { finalizeLeanOnboarding } from '../../lib/finalizeLeanOnboarding';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ2'>;
};

type Level = 'new' | 'some' | 'experienced';

const LEVELS: { key: Level; label: string; sub: string }[] = [
  { key: 'new',          label: "New to this",      sub: 'Finding your footing.' },
  { key: 'some',         label: 'Some experience',  sub: 'Some time in.' },
  { key: 'experienced',  label: 'Experienced',      sub: 'The work is familiar.' },
];

export default function LeanQ2ExperienceScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selected, setSelected] = useState<Level | null>(null);

  const handleSelect = async (level: Level) => {
    setSelected(level);
    await saveOnboardingData({ fitnessLevel: level });
    // Psych Report #4: step 2 completed
    track('onboarding_step_completed', { step: 2, experience_level: level });
    navigation.navigate('LeanQ3');
  };

  const handleSkip = async () => {
    track('onboarding_skipped', { at_step: 2 });
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await AsyncStorage.setItem('lean_onboarding_intent', 'explore');
    await AsyncStorage.setItem('lean_onboarding_done', 'true');
    // Best-effort backend post; reconcile hook retries on failure.
    await finalizeLeanOnboarding();
    authEvents.emit();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.stepIndicator}>
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotActive]} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
          <Text style={styles.headline}>How long have you been at this?</Text>
          <Text style={styles.subtext}>We shape the first steps to fit.</Text>
        </View>

        {/* Options */}
        <View style={styles.options}>
          {LEVELS.map((l) => (
            <TouchableOpacity
              key={l.key}
              style={[styles.option, selected === l.key && styles.optionSelected]}
              onPress={() => handleSelect(l.key)}
              activeOpacity={0.75}
            >
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected === l.key && styles.optionLabelSelected]}>
                  {l.label}
                </Text>
                <Text style={styles.optionSub}>{l.sub}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Back + Skip */}
        <View style={styles.bottomRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.6}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSkip} style={styles.skipBtn} activeOpacity={0.6}>
            <Text style={styles.skipText}>Skip — I'll set this later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  header: {
    marginBottom: 36,
  },
  stepIndicator: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  dotComplete: {
    backgroundColor: colors.primary,
  },
  headline: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  options: {
    gap: 14,
    flex: 1,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4, // radius.lg
    paddingVertical: 22,
    paddingHorizontal: 22,
  },
  optionSelected: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    backgroundColor: 'rgba(44, 74, 54, 0.04)',
  },
  optionText: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 22,
    fontWeight: '500',
    letterSpacing: 0.4,
    color: colors.textPrimary,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  optionSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  backText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  skipText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },

  });
