/**
 * Day-1 step 1 — Welcome. TGP wordmark fades + lifts in (~600ms), greeting
 * appears with the user's first name once the profile cache resolves.
 * Animations respect Reduce Motion (snap to final state).
 *
 * No back button on this screen — it's the entry to the flow.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../lib/analytics';
import { t } from './i18n/strings';
import type { Day1OnboardingParamList } from '../../navigation/Day1OnboardingNavigator';
import StepHeader from './StepHeader';
import { writeResumeState } from './resume';

type Props = {
  navigation: NativeStackNavigationProp<Day1OnboardingParamList, 'Welcome'>;
};

export default function WelcomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const user = useCurrentUser();
  const firstName = user?.firstName?.trim();

  const [, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    track('day_one_started');
  }, []);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (cancelled) return;
      setReduceMotion(v);
      if (v) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const greeting = firstName
    ? t('welcome.greetingWithName', { firstName })
    : t('welcome.greetingFallback');

  const handleStart = () => {
    track('day_one_step_completed', { step: 1, screen: 'welcome' });
    writeResumeState({ step: 'CoachPairing' });
    navigation.navigate('CoachPairing');
  };

  return (
    <SafeAreaView style={styles.container} testID="day-one-welcome">
      <StepHeader step={1} />
      <View style={styles.inner}>
        <Animated.View
          style={[styles.logoBlock, { opacity, transform: [{ translateY }] }]}
        >
          <Text
            style={styles.wordmark}
            accessibilityRole="image"
            accessibilityLabel={t('welcome.logoA11y')}
          >
            TGP
          </Text>
          <View style={styles.logoUnderline} />
        </Animated.View>

        <View style={styles.copy}>
          <Text style={styles.headline} accessibilityRole="header">
            {greeting}
          </Text>
          <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>
        </View>

        <TouchableOpacity
          style={styles.cta}
          activeOpacity={0.85}
          onPress={handleStart}
          accessibilityRole="button"
          accessibilityLabel={t('welcome.cta')}
          testID="day-one-welcome-cta"
        >
          <Text style={styles.ctaText}>{t('welcome.cta')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: {
      flex: 1,
      paddingHorizontal: 24,
      paddingBottom: 32,
      justifyContent: 'space-between',
    },
    logoBlock: {
      alignItems: 'center',
      marginTop: 56,
    },
    wordmark: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 64,
      lineHeight: 70,
      letterSpacing: 4,
      color: colors.primary,
    },
    logoUnderline: {
      width: 48,
      height: 1.5,
      backgroundColor: colors.primary,
      marginTop: 8,
      opacity: 0.7,
    },
    copy: {
      marginBottom: 40,
    },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 36,
      letterSpacing: 0.6,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 12,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 12,
    },
    cta: {
      backgroundColor: colors.primary,
      paddingVertical: 18,
      borderRadius: 2,
      alignItems: 'center',
    },
    ctaText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
  });
