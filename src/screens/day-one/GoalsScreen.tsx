/**
 * Day-1 step 3 — Goal selection. Multi-select chips, persist on advance.
 * Skip allowed (the spec carves out goals + check-in as skip-eligible).
 * On network failure, we render an inline retry banner instead of an Alert
 * — keeps the brand-feel guarantee (Rule 8).
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
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
import { saveGoals, type GoalKey } from './api';
import type { Day1OnboardingParamList } from '../../navigation/Day1OnboardingNavigator';

type Props = {
  navigation: NativeStackNavigationProp<Day1OnboardingParamList, 'Goals'>;
};

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface GoalRow {
  key: GoalKey;
  i18nBase: string;
  icon: IconName;
}

const GOALS: GoalRow[] = [
  { key: 'fitness',         i18nBase: 'goals.categories.fitness',        icon: 'barbell-outline' },
  { key: 'business',        i18nBase: 'goals.categories.business',       icon: 'briefcase-outline' },
  { key: 'personal_growth', i18nBase: 'goals.categories.personalGrowth', icon: 'leaf-outline' },
  { key: 'relationships',   i18nBase: 'goals.categories.relationships',  icon: 'people-outline' },
  { key: 'mental_health',   i18nBase: 'goals.categories.mentalHealth',   icon: 'pulse-outline' },
  { key: 'custom',          i18nBase: 'goals.categories.custom',         icon: 'sparkles-outline' },
];

export default function GoalsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selected, setSelected] = useState<Set<GoalKey>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [retryError, setRetryError] = useState(false);

  const toggle = (k: GoalKey) => {
    setRetryError(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const advance = (chosen: GoalKey[]) => {
    track('day_one_step_completed', { step: 3, screen: 'goals', count: chosen.length });
    navigation.navigate('Notifications');
  };

  const handleContinue = async () => {
    const chosen = Array.from(selected);
    if (chosen.length === 0) return;
    setSubmitting(true);
    setRetryError(false);
    try {
      await saveGoals(chosen);
      setSubmitting(false);
      advance(chosen);
    } catch {
      setSubmitting(false);
      setRetryError(true);
    }
  };

  const handleSkip = () => {
    track('day_one_step_skipped', { step: 3, screen: 'goals' });
    navigation.navigate('Notifications');
  };

  return (
    <SafeAreaView style={styles.container} testID="day-one-goals">
      <StepHeader step={2} onBack={() => navigation.goBack()} />
      <View style={styles.inner}>
        <View style={styles.copy}>
          <Text style={styles.headline} accessibilityRole="header">
            {t('goals.title')}
          </Text>
          <Text style={styles.subtitle}>{t('goals.subtitle')}</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {GOALS.map((g) => {
            const isOn = selected.has(g.key);
            return (
              <TouchableOpacity
                key={g.key}
                style={[styles.row, isOn && styles.rowSelected]}
                onPress={() => toggle(g.key)}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isOn }}
                accessibilityLabel={t(`${g.i18nBase}.label` as never)}
                accessibilityHint={t(`${g.i18nBase}.sub` as never)}
                testID={`day-one-goal-${g.key}`}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={g.icon} size={22} color={isOn ? colors.primary : colors.textSecondary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, isOn && styles.rowLabelOn]}>
                    {t(`${g.i18nBase}.label` as never)}
                  </Text>
                  <Text style={styles.rowSub}>{t(`${g.i18nBase}.sub` as never)}</Text>
                </View>
                <View style={[styles.check, isOn && styles.checkOn]}>
                  {isOn ? (
                    <Ionicons name="checkmark" size={16} color={colors.textOnPrimary} />
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {retryError ? (
          <View style={styles.errorBanner} accessibilityRole="alert" testID="day-one-goals-error">
            <Text style={styles.errorTitle}>{t('common.saveFailed.title')}</Text>
            <Text style={styles.errorBody}>{t('common.saveFailed.body')}</Text>
            <TouchableOpacity
              onPress={handleContinue}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
              testID="day-one-goals-retry"
            >
              <Text style={styles.errorCta}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.cta, (selected.size === 0 || submitting) && styles.ctaDisabled]}
            activeOpacity={0.85}
            onPress={handleContinue}
            disabled={selected.size === 0 || submitting}
            accessibilityRole="button"
            accessibilityLabel={t('goals.continue')}
            accessibilityState={{ disabled: selected.size === 0, busy: submitting }}
            testID="day-one-goals-continue"
          >
            {submitting ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.ctaText}>{t('goals.continue')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel={t('goals.skip')}
            testID="day-one-goals-skip"
          >
            <Text style={styles.skipText}>{t('goals.skip')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
    copy: { marginBottom: 20 },
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
    scroll: { flex: 1 },
    scrollContent: { gap: 12, paddingBottom: 16 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingVertical: 16,
      paddingHorizontal: 16,
      gap: 14,
    },
    rowSelected: {
      borderColor: colors.primary,
      borderWidth: 1.5,
      backgroundColor: colors.primaryPale,
    },
    iconWrap: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: { flex: 1, gap: 2 },
    rowLabel: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      letterSpacing: 0.4,
      color: colors.textPrimary,
    },
    rowLabelOn: { color: colors.primary },
    rowSub: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 17,
      color: colors.textSecondary,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    errorBanner: {
      backgroundColor: colors.noticeCriticalBg,
      borderRadius: 4,
      padding: 14,
      marginTop: 8,
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
    actions: { gap: 8, marginTop: 8 },
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
