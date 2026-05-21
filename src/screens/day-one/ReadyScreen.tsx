/**
 * Day-1 step 6 — terminal "you're ready" screen.
 *
 * Owns the final POST that flips `day_one_completed=true` and the
 * authEvents.emit() that swings RootNavigator from onboarding to the
 * authenticated dashboard.
 *
 * Quiet-luxury doctrine: no celebrations, no trophy chrome, no particle
 * burst. The screen is a single fade-in of the check badge plus the copy
 * block, same restraint as MilestoneList. Animation respects Reduce Motion
 * (snaps to final state).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../lib/analytics';
import { authEvents } from '../../utils/authEvents';
import { t } from './i18n/strings';
import { completeDayOne } from './api';
import type { Day1OnboardingParamList } from '../../navigation/Day1OnboardingNavigator';

type Props = {
  navigation: NativeStackNavigationProp<Day1OnboardingParamList, 'Ready'>;
};

export default function ReadyScreen(_props: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const user = useCurrentUser();
  const firstName = user?.firstName?.trim();

  const [reduceMotion, setReduceMotion] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryError, setRetryError] = useState(false);

  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (cancelled) return;
      setReduceMotion(v);
      if (v) {
        opacity.setValue(1);
        return;
      }
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    });
    track('day_one_ready_shown');
    return () => {
      cancelled = true;
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headline = firstName
    ? t('ready.title', { firstName })
    : t('ready.titleFallback');

  const handleFinish = async () => {
    setRetryError(false);
    setSubmitting(true);
    try {
      await completeDayOne();
      track('day_one_completed');
      setSubmitting(false);
      // Root navigator listens for this and re-renders into the dashboard.
      authEvents.emit();
    } catch {
      setSubmitting(false);
      setRetryError(true);
    }
  };

  // reduceMotion is read for its setter side-effect; the JSX below already
  // reflects the final state because we set opacity to 1 inside the effect.
  void reduceMotion;

  return (
    <SafeAreaView style={styles.container} testID="day-one-ready">
      <View style={styles.inner}>
        <Animated.View style={[styles.center, { opacity }]}>
          <View
            style={styles.badge}
            accessibilityRole="image"
            accessibilityLabel={t('ready.badgeA11y')}
          >
            <Ionicons name="checkmark" size={32} color={colors.textOnPrimary} />
          </View>
          <Text style={styles.headline} accessibilityRole="header">
            {headline}
          </Text>
          <View style={styles.divider} />
          <Text style={styles.subtitle}>{t('ready.subtitle')}</Text>
        </Animated.View>

        {retryError ? (
          <View
            style={styles.errorBanner}
            accessibilityRole="alert"
            testID="day-one-ready-error"
          >
            <Text style={styles.errorTitle}>{t('common.saveFailed.title')}</Text>
            <Text style={styles.errorBody}>{t('common.saveFailed.body')}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.cta, submitting && styles.ctaDisabled]}
          activeOpacity={0.85}
          onPress={handleFinish}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={t('ready.cta')}
          accessibilityState={{ busy: submitting }}
          testID="day-one-ready-cta"
        >
          {submitting ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.ctaText}>{t('ready.cta')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { flex: 1, paddingHorizontal: 24, paddingBottom: 32 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    badge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: 0.6,
      color: colors.textPrimary,
      textAlign: 'center',
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    divider: {
      width: 32,
      height: 1,
      backgroundColor: colors.border,
      marginBottom: 16,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 12,
    },
    errorBanner: {
      backgroundColor: colors.noticeCriticalBg,
      borderRadius: 4,
      padding: 14,
      marginBottom: 12,
    },
    errorTitle: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      color: colors.noticeCriticalText,
      marginBottom: 4,
    },
    errorBody: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.noticeCriticalText,
    },
    cta: {
      backgroundColor: colors.primary,
      paddingVertical: 18,
      borderRadius: 2,
      alignItems: 'center',
    },
    ctaDisabled: { opacity: 0.4 },
    ctaText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
  });
