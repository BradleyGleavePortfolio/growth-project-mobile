/**
 * Day-1 step 4 — Notification permission ask (with context).
 *
 * We surface the value-prop bullets BEFORE the native permission dialog so
 * the user understands what they're consenting to. Denial never blocks the
 * flow — we show a polite "you can enable later" notice and advance to the
 * next step (Rule 11: never shrink — the flow continues either way).
 */

import React, { useMemo, useState } from 'react';
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
import { registerForPushNotifications } from '../../services/pushNotifications';
import { track } from '../../lib/analytics';
import { t, tList } from './i18n/strings';
import StepHeader from './StepHeader';
import { saveNotifPermission } from './api';
import { writeResumeState } from './resume';
import type { Day1OnboardingParamList } from '../../navigation/Day1OnboardingNavigator';

type Props = {
  navigation: NativeStackNavigationProp<Day1OnboardingParamList, 'Notifications'>;
};

export default function NotificationsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [submitting, setSubmitting] = useState(false);
  const [denied, setDenied] = useState(false);

  const advance = () => {
    writeResumeState({ step: 'CheckInTime' });
    navigation.navigate('CheckInTime');
  };

  const recordOutcome = async (state: 'granted' | 'denied' | 'skipped') => {
    // Persistence failure is intentionally non-blocking: the funnel must
    // never be held hostage by a backend wobble (Rule 6 — root-fix the
    // backend later; do NOT trap the user here).
    try { await saveNotifPermission(state); } catch { /* logged below */ }
    await writeResumeState({ draft: { notifState: state } });
    track('day_one_step_completed', { step: 4, screen: 'notifications', state });
  };

  const handleEnable = async () => {
    setSubmitting(true);
    const result = await registerForPushNotifications();
    setSubmitting(false);
    if (result.granted) {
      await recordOutcome('granted');
      advance();
      return;
    }
    setDenied(true);
    await recordOutcome('denied');
  };

  const handleSkip = async () => {
    await recordOutcome('skipped');
    advance();
  };

  const handleContinueAfterDeny = async () => {
    advance();
  };

  return (
    <SafeAreaView style={styles.container} testID="day-one-notifications">
      <StepHeader step={4} onBack={() => navigation.goBack()} />
      <View style={styles.inner}>
        <View style={styles.iconHeader}>
          <View style={styles.iconCircle}>
            <Ionicons name="notifications-outline" size={28} color={colors.primary} />
          </View>
        </View>
        <View style={styles.copy}>
          <Text style={styles.headline} accessibilityRole="header">
            {t('notifications.title')}
          </Text>
          <Text style={styles.subtitle}>{t('notifications.subtitle')}</Text>
        </View>

        <View style={styles.bullets}>
          {tList('notifications.bullets').map((b) => (
            <View style={styles.bulletRow} key={b}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>

        {denied ? (
          <View style={styles.denyNotice} accessibilityRole="alert" testID="day-one-notifications-deny-notice">
            <Text style={styles.denyText}>{t('notifications.deniedNotice')}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {denied ? (
            <TouchableOpacity
              style={styles.cta}
              activeOpacity={0.85}
              onPress={handleContinueAfterDeny}
              accessibilityRole="button"
              accessibilityLabel={t('common.continue')}
              testID="day-one-notifications-continue"
            >
              <Text style={styles.ctaText}>{t('common.continue')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.cta, submitting && styles.ctaDisabled]}
              activeOpacity={0.85}
              onPress={handleEnable}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={t('notifications.enable')}
              accessibilityState={{ busy: submitting }}
              testID="day-one-notifications-enable"
            >
              {submitting ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.ctaText}>{t('notifications.enable')}</Text>
              )}
            </TouchableOpacity>
          )}
          {!denied ? (
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel={t('notifications.skip')}
              testID="day-one-notifications-skip"
            >
              <Text style={styles.skipText}>{t('notifications.skip')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
    iconHeader: { alignItems: 'center', marginTop: 12, marginBottom: 24 },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.primaryPale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: { marginBottom: 24, alignItems: 'center' },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 30,
      lineHeight: 34,
      letterSpacing: 0.6,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 10,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 12,
    },
    bullets: { gap: 12, marginBottom: 24 },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    bulletDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
      marginTop: 8,
    },
    bulletText: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 21,
      color: colors.textPrimary,
    },
    denyNotice: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
    },
    denyText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
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
