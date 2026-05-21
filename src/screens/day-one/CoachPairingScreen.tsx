/**
 * Day-1 step 2 — Coach pairing.
 *
 * Two entry modes:
 *  - Deep-link: a `prefillCode` route param arrives from the deferred-invite
 *    handler. The field is filled and the Skip button is hidden — the spec
 *    is explicit that we don't let users skip when an invite has been
 *    presented (they reached this screen because someone gave them a code).
 *  - Manual: user types a code OR taps "I don't have a code yet".
 *
 * Errors map to structured copy (Rule 9). The submit button shows an inline
 * spinner; errors render below the input without an Alert (Rule 8 in-app
 * feel — never a native modal that breaks the brand).
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { track } from '../../lib/analytics';
import { writePendingInviteCode } from '../../lib/pendingInviteCode';
import { t } from './i18n/strings';
import { pairWithCoach, type DayOneError } from './api';
import StepHeader from './StepHeader';
import type { Day1OnboardingParamList } from '../../navigation/Day1OnboardingNavigator';

type Props = {
  navigation: NativeStackNavigationProp<Day1OnboardingParamList, 'CoachPairing'>;
  route: RouteProp<Day1OnboardingParamList, 'CoachPairing'>;
};

function errorCopy(e: DayOneError): string {
  switch (e.kind) {
    case 'invite_expired':
      return t('coachPairing.errors.expired');
    case 'invite_max_uses':
      return t('coachPairing.errors.maxUses');
    case 'network':
      return t('coachPairing.errors.network');
    case 'server':
      return t('coachPairing.errors.network');
    case 'invite_invalid':
    default:
      return t('coachPairing.errors.notRecognized');
  }
}

export default function CoachPairingScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const prefillCode = route.params?.prefillCode?.trim() ?? '';
  const fromDeepLink = !!prefillCode;

  const [code, setCode] = useState(prefillCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.trim().length >= 4 && !submitting;

  const handleSubmit = async () => {
    setError(null);
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      setError(t('coachPairing.errors.tooShort'));
      return;
    }
    setSubmitting(true);
    const result = await pairWithCoach(trimmed);
    setSubmitting(false);
    if (result.ok) {
      track('day_one_step_completed', { step: 2, screen: 'coach_pairing', method: fromDeepLink ? 'deep_link' : 'manual' });
      navigation.navigate('Goals');
      return;
    }
    // Stash the code so the same user can retry from the home banner
    // if they back out — keeps Rule 11 (never shrink) intact.
    writePendingInviteCode(trimmed).catch(() => undefined);
    setError(errorCopy(result.error));
  };

  const handleSkip = () => {
    track('day_one_step_skipped', { step: 2, screen: 'coach_pairing' });
    navigation.navigate('Goals');
  };

  return (
    <SafeAreaView style={styles.container} testID="day-one-coach-pairing">
      <StepHeader step={1} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.inner}>
          <View style={styles.copy}>
            <Text style={styles.headline} accessibilityRole="header">
              {t('coachPairing.title')}
            </Text>
            <Text style={styles.subtitle}>{t('coachPairing.subtitle')}</Text>
          </View>

          {fromDeepLink ? (
            <View style={styles.deepLinkBanner} accessibilityRole="alert">
              <Text style={styles.deepLinkBannerText}>
                {t('coachPairing.deepLinkBanner')}
              </Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>{t('coachPairing.inputLabel')}</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={(v) => {
                setError(null);
                setCode(v.toUpperCase());
              }}
              placeholder={t('coachPairing.inputPlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              accessibilityLabel={t('coachPairing.inputLabel')}
              testID="day-one-invite-input"
            />
            {error ? (
              <Text style={styles.errorText} testID="day-one-invite-error">
                {error}
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.cta, !canSubmit && styles.ctaDisabled]}
              activeOpacity={0.85}
              onPress={handleSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel={t('coachPairing.submit')}
              accessibilityState={{ disabled: !canSubmit, busy: submitting }}
              testID="day-one-invite-submit"
            >
              {submitting ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.ctaText}>{t('coachPairing.submit')}</Text>
              )}
            </TouchableOpacity>

            {!fromDeepLink ? (
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleSkip}
                accessibilityRole="button"
                accessibilityLabel={t('coachPairing.skip')}
                testID="day-one-invite-skip"
              >
                <Text style={styles.skipText}>{t('coachPairing.skip')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    inner: { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
    copy: { marginBottom: 28 },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 36,
      letterSpacing: 0.6,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    deepLinkBanner: {
      backgroundColor: colors.primaryPale,
      borderRadius: 4,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 20,
    },
    deepLinkBannerText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: colors.primary,
    },
    field: { marginBottom: 24 },
    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      letterSpacing: 1.98,
      textTransform: 'uppercase',
      color: colors.primary,
      marginBottom: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 2,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontFamily: 'Inter_500Medium',
      fontSize: 18,
      letterSpacing: 2,
      color: colors.textPrimary,
    },
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: colors.error,
      marginTop: 8,
    },
    actions: { marginTop: 'auto', gap: 8 },
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
    skipBtn: {
      alignSelf: 'center',
      paddingVertical: 12,
      paddingHorizontal: 20,
    },
    skipText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      letterSpacing: 0.3,
    },
  });
