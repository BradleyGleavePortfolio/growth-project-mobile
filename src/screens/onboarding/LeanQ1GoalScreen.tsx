/**
 * LeanQ1GoalScreen — Psych Report #1 "Activation-First Dopamine"
 * Q1: Primary goal — lose weight / build muscle / maintain
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
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ1'>;
};

type Goal = 'lose_weight' | 'build_muscle' | 'maintain';

const GOALS: { key: Goal; label: string; sub: string }[] = [
  { key: 'lose_weight',  label: 'Lose Weight',  sub: 'A gradual shift.' },
  { key: 'build_muscle', label: 'Build Muscle', sub: 'Slow, deliberate strength.' },
  { key: 'maintain',     label: 'Maintain',     sub: 'Hold the line.' },
];

export default function LeanQ1GoalScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selected, setSelected] = useState<Goal | null>(null);

  // Psych Report #4: Analytics — onboarding_started fires on mount of Q1
  React.useEffect(() => { track('onboarding_started'); }, []);

  const handleSelect = async (goal: Goal) => {
    setSelected(goal);
    await saveOnboardingData({ primaryGoal: goal });
    // Psych Report #4: step 1 completed
    track('onboarding_step_completed', { step: 1, goal });
    navigation.navigate('LeanQ2');
  };

  const handleSkip = async () => {
    track('onboarding_skipped', { at_step: 1 });
    await markOnboardingComplete('explore');
  };

  const markOnboardingComplete = async (intent: string) => {
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await AsyncStorage.setItem('lean_onboarding_intent', intent);
    await AsyncStorage.setItem('lean_onboarding_done', 'true');
    // Trigger root re-render via authEvents
    authEvents.emit();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.stepIndicator}>
            <View style={[styles.dot, styles.dotActive]} />
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
          <Text style={styles.headline}>Where are you headed?</Text>
          <Text style={styles.subtext}>One direction at a time.</Text>
        </View>

        {/* Options */}
        <View style={styles.options}>
          {GOALS.map((g) => (
            <TouchableOpacity
              key={g.key}
              style={[styles.option, selected === g.key && styles.optionSelected]}
              onPress={() => handleSelect(g.key)}
              activeOpacity={0.75}
            >
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected === g.key && styles.optionLabelSelected]}>
                  {g.label}
                </Text>
                <Text style={styles.optionSub}>{g.sub}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Skip */}
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.6}>
          <Text style={styles.skipText}>Skip — I'll set this later</Text>
        </TouchableOpacity>
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
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  skipText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },

  });
