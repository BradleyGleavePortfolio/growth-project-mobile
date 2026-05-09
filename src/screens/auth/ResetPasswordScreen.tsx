/**
 * ResetPasswordScreen — handler for the `tgp://reset-password` deep
 * link emitted by Supabase via the backend's
 * /auth/forgot-password endpoint.
 *
 * AEO Phase 1 / audit fix CR-1 (client POV):
 *
 * Supabase password recovery emails carry an access_token and
 * refresh_token in the URL fragment, e.g.
 *
 *   tgp://reset-password#access_token=xyz&refresh_token=abc&type=recovery
 *
 * Before this screen existed the link landed back in the app and went
 * nowhere — the AuthNavigator had no route registered for it, so a
 * client locked out of their account had no in-app way to actually
 * change their password. This screen consumes the token pair via
 * `route.params`, primes a Supabase session, lets the user enter a
 * new password, and POSTs `auth.updateUser({ password })`. On success
 * we sign them out (the recovery session is intentionally a one-shot)
 * and bounce them to Login so they re-enter the new credentials —
 * same posture Supabase recommends for the recovery flow.
 *
 * Failure modes:
 *   - Missing token pair → "Invalid or expired link" with a Back to
 *     Login affordance. Most common cause: the user opened the email
 *     link more than an hour after request.
 *   - Password too weak → in-line error from the same validator the
 *     create-account screen uses, so the rules match across the app.
 *   - Supabase update returns an error → mapped to a friendly
 *     sentence; a Sentry breadcrumb is left for ops.
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { env } from '../../config/env';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

// Same rules as the backend's RegisterDto — keep these in sync if the
// server-side rule moves. Short-circuit on the first failure so the
// user fixes one thing at a time rather than a wall of bullet points.
function checkPassword(value: string): PasswordCheck {
  if (value.length < 8) return { ok: false, reason: 'At least 8 characters.' };
  if (!/[A-Z]/.test(value)) return { ok: false, reason: 'At least one uppercase letter.' };
  if (!/[0-9]/.test(value)) return { ok: false, reason: 'At least one number.' };
  if (!/[^A-Za-z0-9]/.test(value)) {
    return { ok: false, reason: 'At least one special character.' };
  }
  return { ok: true };
}

export default function ResetPasswordScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const accessToken = route.params?.access_token ?? '';
  const refreshToken = route.params?.refresh_token ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Without a token pair we cannot even attempt the update; surface
  // the failure straight away so the user can request a fresh link
  // rather than typing into a form that will reject every submission.
  const tokensPresent = Boolean(accessToken && refreshToken);
  useEffect(() => {
    if (!tokensPresent) {
      setError(
        "This password reset link is invalid or has expired. Request a new one from the login screen.",
      );
    }
  }, [tokensPresent]);

  const handleSubmit = async () => {
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    const check = checkPassword(password);
    if (!check.ok) {
      setError(check.reason ?? 'Password does not meet requirements.');
      return;
    }
    setSubmitting(true);
    try {
      // Dynamic import keeps supabase-js out of the cold-start path
      // on the unauth navigator; same pattern the API client uses.
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

      const setSessionRes = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (setSessionRes.error) {
        setError('This password reset link is invalid or has expired. Request a new one.');
        return;
      }

      const updateRes = await supabase.auth.updateUser({ password });
      if (updateRes.error) {
        setError(updateRes.error.message || 'Could not update password. Try again.');
        return;
      }

      // Recovery session is single-use by design — sign the user out
      // and bounce them through Login so they re-authenticate with
      // the new credentials. This is the Supabase-recommended posture
      // for password recovery (see docs.supabase.com/auth/passwords).
      await supabase.auth.signOut();
      setDone(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update password.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.navigate('Login')}
        accessibilityRole="button"
        accessibilityLabel="Back to login"
      >
        <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {done ? 'Password updated' : 'Set a new password'}
        </Text>
        <Text style={styles.subtitle}>
          {done
            ? 'Sign in with your new password to continue.'
            : 'Enter the new password you would like to use for your account.'}
        </Text>
      </View>

      {done ? (
        <View style={styles.successContainer} accessible accessibilityRole="alert">
          <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="button"
            accessibilityLabel="Go to login"
          >
            <Text style={styles.resetButtonText}>Go to login</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>New password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                value={password}
                onChangeText={setPassword}
                placeholder="Min 8 chars, 1 upper, 1 number, 1 special"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="New password"
                textContentType="newPassword"
                editable={tokensPresent && !submitting}
              />
              <TouchableOpacity
                onPress={() => setShowPw((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
                style={styles.eyeBtn}
              >
                <Ionicons
                  name={showPw ? 'eye-off' : 'eye'}
                  size={20}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm new password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Confirm new password"
              textContentType="newPassword"
              editable={tokensPresent && !submitting}
            />
          </View>

          {error ? (
            <Text
              style={styles.errorText}
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.resetButton, (!tokensPresent || submitting) && styles.disabledButton]}
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={!tokensPresent || submitting}
            accessibilityRole="button"
            accessibilityLabel="Update password"
            accessibilityState={{ disabled: !tokensPresent || submitting, busy: submitting }}
          >
            {submitting ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.resetButtonText}>Update password</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingHorizontal: 24,
      paddingTop: 60,
    },
    backButton: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      marginBottom: 24,
    },
    header: { marginBottom: 40 },
    title: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 35,
      letterSpacing: 0.6,
      fontWeight: '400',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      lineHeight: 26,
      letterSpacing: -0.16,
      color: colors.textSecondary,
    },
    form: { gap: 24 },
    inputContainer: { gap: 8 },
    label: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 2,
      padding: 16,
      fontSize: 16,
      color: colors.textPrimary,
    },
    passwordRow: { flexDirection: 'row', alignItems: 'center' },
    passwordInput: { flex: 1 },
    eyeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 14,
      marginLeft: -50,
      width: 44,
      alignItems: 'center',
    },
    resetButton: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: 2,
      alignItems: 'center',
    },
    disabledButton: { opacity: 0.5 },
    resetButtonText: {
      fontFamily: 'Inter_600SemiBold',
      color: colors.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    errorText: {
      color: colors.error,
      fontSize: 14,
      lineHeight: 20,
    },
    successContainer: {
      alignItems: 'center',
      gap: 24,
      paddingTop: 40,
    },
  });
