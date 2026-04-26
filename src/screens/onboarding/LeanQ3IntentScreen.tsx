/**
 * LeanQ3IntentScreen — Psych Report #1 "Activation-First Dopamine"
 * Q3: Today's intent — workout / track meals / explore
 *
 * After selection (or skip), marks onboarding complete, saves intent to
 * AsyncStorage, and re-boots root navigator so the user lands on HomeScreen
 * with the HeroAction pre-set to match their intent.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LeanOnboardingParamList } from '../../navigation/LeanOnboardingNavigator';
import { Colors } from '../../constants/colors';
import { saveOnboardingData } from '../../utils/onboardingStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../../lib/analytics';

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ3'>;
};

export type TodayIntent = 'workout' | 'track_meals' | 'explore';

const INTENTS: { key: TodayIntent; icon: string; label: string; sub: string; identity: string }[] = [
  {
    key: 'workout',
    icon: '🏋️',
    label: 'Log a workout',
    sub: 'Start your first session right now',
    identity: 'Athlete',
  },
  {
    key: 'track_meals',
    icon: '🥗',
    label: 'Track my meals',
    sub: 'Log what I eat and hit my targets',
    identity: 'Nutrition Pro',
  },
  {
    key: 'explore',
    icon: '🧭',
    label: 'Just explore',
    sub: "I'll figure out what's here",
    identity: 'Explorer',
  },
];

export default function LeanQ3IntentScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<TodayIntent | null>(null);
  const [loading, setLoading] = useState(false);

  const finishOnboarding = async (intent: TodayIntent, skipped = false) => {
    setLoading(true);
    try {
      await saveOnboardingData({ activityLevel: intent });
      await AsyncStorage.setItem('onboarding_complete', 'true');
      await AsyncStorage.setItem('lean_onboarding_intent', intent);
      await AsyncStorage.setItem('lean_onboarding_done', 'true');
      // Psych Report #4: onboarding_completed or onboarding_skipped
      if (skipped) {
        track('onboarding_skipped', { at_step: 3 });
      } else {
        track('onboarding_step_completed', { step: 3, intent });
        track('onboarding_completed', { intent });
      }
      // Fire root navigator refresh
      const { authEvents } = require('../../utils/authEvents');
      authEvents.emitAuthChange();
    } catch {
      setLoading(false);
    }
  };

  const handleSelect = async (intent: TodayIntent) => {
    setSelected(intent);
    await finishOnboarding(intent, false);
  };

  const handleSkip = async () => {
    await finishOnboarding('explore', true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.stepIndicator}>
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotComplete]} />
            <View style={[styles.dot, styles.dotActive]} />
          </View>
          <Text style={styles.headline}>What do you want to do first?</Text>
          <Text style={styles.subtext}>
            We'll set up your home screen to make it instant.
          </Text>
        </View>

        {/* Options */}
        <View style={styles.options}>
          {INTENTS.map((i) => (
            <TouchableOpacity
              key={i.key}
              style={[styles.option, selected === i.key && styles.optionSelected]}
              onPress={() => handleSelect(i.key)}
              activeOpacity={0.75}
              disabled={loading}
            >
              <Text style={styles.optionIcon}>{i.icon}</Text>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected === i.key && styles.optionLabelSelected]}>
                  {i.label}
                </Text>
                <Text style={styles.optionSub}>{i.sub}</Text>
              </View>
              {selected === i.key && loading && (
                <ActivityIndicator size="small" color={Colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Identity teaser */}
        <View style={styles.identityHint}>
          <Text style={styles.identityHintText}>
            Your identity title unlocks on your first win
          </Text>
        </View>

        {/* Back + Skip */}
        <View style={styles.bottomRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.6}
            disabled={loading}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSkip}
            style={styles.skipBtn}
            activeOpacity={0.6}
            disabled={loading}
          >
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
    marginBottom: 32,
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
  identityHint: {
    backgroundColor: 'rgba(45, 106, 79, 0.08)',
    borderRadius: 2, // radius.md
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginVertical: 12,
    alignItems: 'center',
  },
  identityHintText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
