/**
 * LeanQ3IntentScreen — Psych Report #1 "Activation-First Dopamine"
 * Q3: Today's intent — workout / track meals / explore
 *
 * After selection (or skip), saves intent then routes to LeanQ4 (essential
 * body metrics). LeanQ4 is the screen that finalises onboarding — it can
 * also be skipped, in which case the onboarding completes without metrics.
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
import { authEvents } from '../../utils/authEvents';

type Props = {
  navigation: NativeStackNavigationProp<LeanOnboardingParamList, 'LeanQ3'>;
};

export type TodayIntent = 'workout' | 'track_meals' | 'explore';

const INTENTS: { key: TodayIntent; label: string; sub: string; identity: string }[] = [
  { key: 'workout',     label: 'Log a workout',  sub: 'Begin your first session.',          identity: 'Athlete' },
  { key: 'track_meals', label: 'Track my meals', sub: 'Log what you eat. Hit your targets.', identity: 'Nutrition Pro' },
  { key: 'explore',     label: 'Just explore',   sub: 'Take a look around.',                 identity: 'Explorer' },
];

export default function LeanQ3IntentScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<TodayIntent | null>(null);
  const [loading, setLoading] = useState(false);

  const persistIntent = async (intent: TodayIntent) => {
    await saveOnboardingData({ activityLevel: intent });
    await AsyncStorage.setItem('lean_onboarding_intent', intent);
  };

  const skipToHome = async (intent: TodayIntent) => {
    setLoading(true);
    try {
      await persistIntent(intent);
      await AsyncStorage.setItem('onboarding_complete', 'true');
      await AsyncStorage.setItem('lean_onboarding_done', 'true');
      track('onboarding_skipped', { at_step: 3 });
      authEvents.emit();
    } catch {
      setLoading(false);
    }
  };

  const handleSelect = async (intent: TodayIntent) => {
    setSelected(intent);
    setLoading(true);
    try {
      await persistIntent(intent);
      track('onboarding_step_completed', { step: 3, intent });
      navigation.navigate('LeanQ4');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    await skipToHome('explore');
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
            <View style={styles.dot} />
          </View>
          <Text style={styles.headline}>Where does it begin?</Text>
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
            Your title begins with your first session
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
  options: {
    gap: 14,
    flex: 1,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4, // radius.lg
    paddingVertical: 22,
    paddingHorizontal: 22,
  },
  optionSelected: {
    borderColor: Colors.primary,
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
    color: Colors.textPrimary,
  },
  optionLabelSelected: {
    color: Colors.primary,
  },
  optionSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  identityHint: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginVertical: 8,
    alignItems: 'center',
  },
  identityHintText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 1.98,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: Colors.primary,
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
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
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
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
});
