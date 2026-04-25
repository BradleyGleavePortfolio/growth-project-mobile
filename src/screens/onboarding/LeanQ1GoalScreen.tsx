/**
 * LeanQ1GoalScreen — Psych Report #1 "Activation-First Dopamine"
 * Q1: Primary goal — lose weight / build muscle / maintain
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LeanOnboardingParamList } from '../../navigation/LeanOnboardingNavigator';
import { Colors } from '../../constants/colors';
import { saveOnboardingData } from '../../utils/onboardingStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ1'>;
};

type Goal = 'lose_weight' | 'build_muscle' | 'maintain';

const GOALS: { key: Goal; icon: string; label: string; sub: string }[] = [
  { key: 'lose_weight', icon: '🔥', label: 'Lose Weight', sub: 'Burn fat, feel lighter' },
  { key: 'build_muscle', icon: '💪', label: 'Build Muscle', sub: 'Get stronger, add size' },
  { key: 'maintain', icon: '⚖️', label: 'Maintain', sub: 'Stay consistent, feel great' },
];

export default function LeanQ1GoalScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<Goal | null>(null);

  const handleSelect = async (goal: Goal) => {
    setSelected(goal);
    await saveOnboardingData({ primaryGoal: goal });
    navigation.navigate('LeanQ2');
  };

  const handleSkip = async () => {
    await markOnboardingComplete('explore');
  };

  const markOnboardingComplete = async (intent: string) => {
    await AsyncStorage.setItem('onboarding_complete', 'true');
    await AsyncStorage.setItem('lean_onboarding_intent', intent);
    await AsyncStorage.setItem('lean_onboarding_done', 'true');
    // Trigger root re-render via authEvents
    const { authEvents } = require('../../utils/authEvents');
    authEvents.emitAuthChange();
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
          </View>
          <Text style={styles.headline}>What's your primary goal?</Text>
          <Text style={styles.subtext}>Pick one — you can always change it later.</Text>
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
              <Text style={styles.optionIcon}>{g.icon}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    backgroundColor: Colors.border,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 24,
  },
  headline: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtext: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  options: {
    gap: 14,
    flex: 1,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  optionSelected: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(45, 106, 79, 0.07)',
  },
  optionIcon: {
    fontSize: 32,
  },
  optionText: {
    flex: 1,
    gap: 4,
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  optionLabelSelected: {
    color: Colors.primary,
  },
  optionSub: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  skipText: {
    fontSize: 14,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
});
