/**
 * Day-1 step 5 — terminal "you're ready" screen.
 *
 * Owns the final POST that flips `day_one_completed=true` and the
 * authEvents.emit() that swings RootNavigator from onboarding to the
 * authenticated dashboard.
 *
 * Quiet-luxury doctrine: no celebrations, no trophy chrome, no particle
 * burst. The screen is a single fade-in of the welcome
 * block, same restraint as MilestoneList. Animation respects Reduce Motion
 * (snaps to final state).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { track } from '../../lib/analytics';
import { authEvents } from '../../utils/authEvents';
import { patchUserCache } from '../../lib/userCache';
import { t } from './i18n/strings';
import { completeDayOne } from './api';
import StepHeader, { useDayOneColors, type DayOneColors } from './StepHeader';
import {
  clearResumeState,
  enqueuePending,
  flushPendingSync,
  readResumeState,
  writeResumeState,
} from './resume';
import { keepDayOneAnswers } from './answers';
import type { Day1OnboardingParamList } from '../../navigation/Day1OnboardingNavigator';

type Props = {
  navigation: NativeStackNavigationProp<Day1OnboardingParamList, 'Ready'>;
};

export default function ReadyScreen(_props: Props) {
  const colors = useDayOneColors();
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

  const markLocalComplete = async () => {
    await AsyncStorage.setItem('day_one_completed', 'true');
    await patchUserCache({ profile: { day_one_completed: true } });
  };

  // B-441-1: the backend has no field for the goals or the check-in time, so
  // the draft is the only other copy. Keep it for this account before the
  // checkpoint is cleared; true when the answers are safe to drop from it.
  const keepAnswers = async (): Promise<boolean> => {
    const draft = (await readResumeState())?.draft;
    if (!draft) return true;
    return keepDayOneAnswers(
      {
        goals: draft.goals,
        checkInTime: draft.checkInTime,
        checkInTimezone: draft.checkInTimezone,
      },
      user?.id,
    );
  };

  const handleFinish = async () => {
    setRetryError(false);
    setSubmitting(true);
    try {
      // Drain anything the user queued via "Continue offline" before flipping
      // the terminal flag — order matters so the backend sees the per-step
      // payloads before day_one_completed.
      await flushPendingSync();
      await completeDayOne();
      await markLocalComplete();
      // A checkpoint whose answers could not be kept stays on the device (the
      // Day-1 gate already passes on the local completion flag).
      if (await keepAnswers()) await clearResumeState();
      track('day_one_completed');
      setSubmitting(false);
      // Root navigator listens for this and re-renders into the dashboard.
      authEvents.emit();
    } catch {
      setSubmitting(false);
      setRetryError(true);
    }
  };

  const handleFinishOffline = async () => {
    await keepAnswers();
    await writeResumeState({ step: 'Ready' });
    await enqueuePending({ kind: 'complete' });
    // Mark local-done so the next boot bypasses Day-1 even if the backend
    // never received the flip. The queued `complete` item will be flushed
    // when connectivity returns.
    await markLocalComplete();
    track('day_one_offline_complete');
    authEvents.emit();
  };

  // reduceMotion is read for its setter side-effect; the JSX below already
  // reflects the final state because we set opacity to 1 inside the effect.
  void reduceMotion;

  return (
    <SafeAreaView style={styles.container} testID="day-one-ready">
      <StepHeader step={5} />
      <ScrollView contentContainerStyle={styles.inner}>
        <Animated.View style={[styles.center, { opacity }]}>
          <Text style={styles.headline} accessibilityRole="header">
            {headline}
          </Text>
        </Animated.View>

        {retryError ? (
          <View
            style={styles.errorBanner}
            accessibilityRole="alert"
            testID="day-one-ready-error"
          >
            <Text style={styles.errorTitle}>{t('common.saveFailed.title')}</Text>
            <Text style={styles.errorBody}>{t('common.saveFailed.body')}</Text>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={handleFinishOffline}
              accessibilityRole="button"
              accessibilityLabel={t('common.saveLater')}
              testID="day-one-ready-offline"
            >
              <Text style={styles.errorCtaSecondary}>{t('common.saveLater')}</Text>
            </TouchableOpacity>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DayOneColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    errorBanner: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: 14,
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
      marginBottom: 8,
    },
    errorCtaSecondary: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      lineHeight: 19,
      color: colors.noticeCriticalAccent,
      opacity: 0.85,
    },
    secondaryAction: { minHeight: 44, justifyContent: 'center' },
    cta: {
      backgroundColor: colors.primary,
      paddingVertical: 18,
      minHeight: 56,
      borderRadius: 4,
      alignItems: 'center',
    },
    ctaDisabled: { opacity: 0.4 },
    ctaText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
      color: colors.textOnPrimary,
    },
  });
