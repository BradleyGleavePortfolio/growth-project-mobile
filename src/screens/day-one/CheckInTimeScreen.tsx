/**
 * Day-1 step 5 — Pick a daily check-in time.
 *
 * We render lightweight hour / minute / period steppers instead of pulling in
 * a native datetime picker — keeps the bundle small and the UI on-brand
 * (Rule 8 in-app feel). Default is 9:00 AM local; persists on Continue.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { track } from '../../lib/analytics';
import { t } from './i18n/strings';
import StepHeader from './StepHeader';
import { getDeviceTimezone, saveCheckInTime } from './api';
import { enqueuePending, readResumeState, writeResumeState } from './resume';
import type { Day1OnboardingParamList } from '../../navigation/Day1OnboardingNavigator';

type Props = {
  navigation: NativeStackNavigationProp<Day1OnboardingParamList, 'CheckInTime'>;
};

const DEFAULT_HOUR_24 = 9;
const DEFAULT_MIN = 0;

function to12h(h24: number): { hour12: number; period: 'AM' | 'PM' } {
  const period = h24 >= 12 ? 'PM' : 'AM';
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, period };
}

function to24h(hour12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

export default function CheckInTimeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const initial = to12h(DEFAULT_HOUR_24);
  const [hour12, setHour12] = useState<number>(initial.hour12);
  const [minute, setMinute] = useState<number>(DEFAULT_MIN);
  const [period, setPeriod] = useState<'AM' | 'PM'>(initial.period);
  const [submitting, setSubmitting] = useState(false);
  const [retryError, setRetryError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readResumeState().then((s) => {
      if (cancelled || !s?.draft.checkInTime) return;
      const { hour, minute: m } = s.draft.checkInTime;
      const t12 = to12h(hour);
      setHour12(t12.hour12);
      setPeriod(t12.period);
      setMinute(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bumpHour = (delta: number) => {
    setRetryError(false);
    setHour12((h) => {
      const next = ((h - 1 + delta + 12) % 12) + 1;
      return next;
    });
  };
  const bumpMinute = (delta: number) => {
    setRetryError(false);
    setMinute((m) => ((m + delta + 60) % 60));
  };

  const advance = async () => {
    setRetryError(false);
    setSubmitting(true);
    const h24 = to24h(hour12, period);
    const tz = getDeviceTimezone();
    try {
      await saveCheckInTime({ hour: h24, minute }, tz);
      track('day_one_step_completed', {
        step: 5,
        screen: 'checkin_time',
        hour: h24,
        minute,
        timezone: tz,
      });
      await writeResumeState({
        step: 'Ready',
        draft: { checkInTime: { hour: h24, minute }, checkInTimezone: tz },
      });
      setSubmitting(false);
      navigation.navigate('Ready');
    } catch {
      setSubmitting(false);
      setRetryError(true);
    }
  };

  const handleContinueOffline = async () => {
    const h24 = to24h(hour12, period);
    const tz = getDeviceTimezone();
    await writeResumeState({
      draft: { checkInTime: { hour: h24, minute }, checkInTimezone: tz },
    });
    await enqueuePending({ kind: 'checkin', time: { hour: h24, minute }, timezone: tz });
    track('day_one_step_offline', { step: 5, screen: 'checkin_time' });
    await writeResumeState({ step: 'Ready' });
    navigation.navigate('Ready');
  };

  const handleSkip = () => {
    track('day_one_step_skipped', { step: 5, screen: 'checkin_time' });
    writeResumeState({ step: 'Ready' });
    navigation.navigate('Ready');
  };

  const minuteLabel = String(minute).padStart(2, '0');

  return (
    <SafeAreaView style={styles.container} testID="day-one-checkin">
      <StepHeader step={5} onBack={() => navigation.goBack()} />
      <View style={styles.inner}>
        <View style={styles.copy}>
          <Text style={styles.headline} accessibilityRole="header">
            {t('checkInTime.title')}
          </Text>
          <Text style={styles.subtitle}>{t('checkInTime.subtitle')}</Text>
        </View>

        <View style={styles.pickerRow} accessibilityLabel={`${hour12}:${minuteLabel} ${period}`}>
          <Stepper
            label={t('checkInTime.hourLabel')}
            value={String(hour12)}
            onIncrement={() => bumpHour(1)}
            onDecrement={() => bumpHour(-1)}
            testIDPrefix="day-one-checkin-hour"
            colors={colors}
          />
          <Text style={styles.colon}>:</Text>
          <Stepper
            label={t('checkInTime.minuteLabel')}
            value={minuteLabel}
            onIncrement={() => bumpMinute(5)}
            onDecrement={() => bumpMinute(-5)}
            testIDPrefix="day-one-checkin-minute"
            colors={colors}
          />
          <View style={styles.periodToggle}>
            {(['AM', 'PM'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.periodBtn, period === p && styles.periodBtnOn]}
                onPress={() => {
                  setRetryError(false);
                  setPeriod(p);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: period === p }}
                accessibilityLabel={p === 'AM' ? t('checkInTime.amLabel') : t('checkInTime.pmLabel')}
                testID={`day-one-checkin-${p.toLowerCase()}`}
              >
                <Text style={[styles.periodText, period === p && styles.periodTextOn]}>
                  {p === 'AM' ? t('checkInTime.amLabel') : t('checkInTime.pmLabel')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={styles.defaultHint}>{t('checkInTime.defaultLabel')}</Text>

        {retryError ? (
          <View style={styles.errorBanner} accessibilityRole="alert" testID="day-one-checkin-error">
            <Text style={styles.errorTitle}>{t('common.saveFailed.title')}</Text>
            <Text style={styles.errorBody}>{t('common.saveFailed.body')}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity
                onPress={advance}
                accessibilityRole="button"
                accessibilityLabel={t('common.retry')}
                testID="day-one-checkin-retry"
              >
                <Text style={styles.errorCta}>{t('common.retry')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleContinueOffline}
                accessibilityRole="button"
                accessibilityLabel={t('common.saveLater')}
                testID="day-one-checkin-offline"
              >
                <Text style={styles.errorCtaSecondary}>{t('common.saveLater')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.cta, submitting && styles.ctaDisabled]}
            activeOpacity={0.85}
            onPress={advance}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={t('checkInTime.continue')}
            accessibilityState={{ busy: submitting }}
            testID="day-one-checkin-continue"
          >
            {submitting ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.ctaText}>{t('checkInTime.continue')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel={t('checkInTime.skip')}
            testID="day-one-checkin-skip"
          >
            <Text style={styles.skipText}>{t('checkInTime.skip')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Stepper sub-component ──────────────────────────────────────────────────
interface StepperProps {
  label: string;
  value: string;
  onIncrement: () => void;
  onDecrement: () => void;
  testIDPrefix: string;
  colors: ThemeColors;
}

function Stepper({ label, value, onIncrement, onDecrement, testIDPrefix, colors }: StepperProps) {
  const s = useMemo(() => stepperStyles(colors), [colors]);
  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity
        style={s.btn}
        onPress={onIncrement}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        testID={`${testIDPrefix}-up`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="chevron-up" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <Text style={s.value} accessibilityLiveRegion="polite" testID={`${testIDPrefix}-value`}>
        {value}
      </Text>
      <TouchableOpacity
        style={s.btn}
        onPress={onDecrement}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        testID={`${testIDPrefix}-down`}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const stepperStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', gap: 4 },
    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: colors.textMuted,
      marginBottom: 4,
    },
    btn: { padding: 4 },
    value: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 44,
      lineHeight: 50,
      color: colors.textPrimary,
      minWidth: 56,
      textAlign: 'center',
    },
  });

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
    copy: { marginBottom: 28 },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 30,
      lineHeight: 34,
      letterSpacing: 0.6,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 12,
      marginTop: 12,
      marginBottom: 16,
    },
    colon: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 44,
      lineHeight: 50,
      color: colors.textPrimary,
      paddingBottom: 4,
    },
    periodToggle: {
      flexDirection: 'column',
      gap: 4,
      marginLeft: 8,
    },
    periodBtn: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 2,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    periodBtnOn: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryPale,
    },
    periodText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      letterSpacing: 1.2,
      color: colors.textSecondary,
    },
    periodTextOn: { color: colors.primary },
    defaultHint: {
      textAlign: 'center',
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
      marginBottom: 16,
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
      marginBottom: 8,
    },
    errorCta: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.noticeCriticalAccent,
    },
    errorActions: { gap: 10 },
    errorCtaSecondary: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      lineHeight: 19,
      color: colors.noticeCriticalAccent,
      opacity: 0.85,
    },
    actions: { gap: 8, marginTop: 'auto' },
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
    skipBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 20 },
    skipText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      letterSpacing: 0.3,
    },
  });
