/**
 * LeanQ2ExperienceScreen — Psych Report #1 "Activation-First Dopamine"
 * Q2: Experience level — new / some / experienced
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
import { track } from '../../lib/analytics';

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ2'>;
};

type Level = 'new' | 'some' | 'experienced';

const LEVELS: { key: Level; icon: string; label: string; sub: string }[] = [
  {
    key: 'new',
    icon: '🌱',
    label: "New to this",
    sub: 'Just getting started — welcome',
  },
  {
    key: 'some',
    icon: '🏃',
    label: 'Some experience',
    sub: 'I work out or track occasionally',
  },
  {
    key: 'experienced',
    icon: '🏆',
    label: 'Experienced',
    sub: "I know what I'm doing, let's go",
  },
];

export default function LeanQ2ExperienceScreen({ navigation }: Props) {
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
    const { authEvents } = require('../../utils/authEvents');
    authEvents.emitAuthChange();
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
          </View>
          <Text style={styles.headline}>What's your experience level?</Text>
          <Text style={styles.subtext}>We'll tailor your first steps to match.</Text>
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
              <Text style={styles.optionIcon}>{l.icon}</Text>
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
  dotComplete: {
    backgroundColor: Colors.primary,
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
    borderRadius: 4, // radius.lg
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
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  skipText: {
    fontSize: 14,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
});
