import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { authApi } from '../../services/api';
import { useTheme } from '../../theme/ThemeProvider';
import { lightTokens, radius, type SemanticTokens } from '../../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>;
};

export default function ForgotPasswordScreen({ navigation }: Props) {
  const { semanticColors: colors = lightTokens } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Minimal email shape check — full validation lives on the backend, but a
  // pre-flight gate keeps users from chasing typos through a fake "sent"
  // screen.
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleReset = async () => {
    const trimmed = email.trim();
    setError('');
    if (!trimmed) {
      setError('Enter your email to continue.');
      return;
    }
    if (!isValidEmail(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await authApi.forgotPassword(trimmed);
      // The anonymous backend response is identical for a missing account
      // and a refused mail send. A completed request proves submission,
      // not email delivery; do not promise a link that may never arrive.
      setSubmitted(true);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } }; message?: string })?.response
          ?.data?.message ||
        (err as { message?: string })?.message ||
        'Could not send reset email. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {/* Round 3: a11y labels on back, email input, reset CTA */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        accessibilityHint="Returns to previous screen"
      >
        <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {submitted ? 'Reset request submitted' : 'Reset password'}
        </Text>
        <Text style={styles.subtitle}>
          {submitted
            ? 'Check your inbox and spam folder'
            : "Enter your email to request a reset link"}
        </Text>
      </View>

      {submitted ? (
        <View style={styles.successContainer} accessible accessibilityRole="alert">
          <Ionicons name="checkmark-circle-outline" size={32} color={colors.textMuted} />
          <Text style={styles.successText}>
            The request for {email.trim()} was submitted. For account privacy,
            this screen cannot confirm whether an email was sent. If no reset
            link arrives, contact support.
          </Text>
          <TouchableOpacity
            style={styles.backToLogin}
            onPress={() => navigation.navigate('SupportInbox')}
            accessibilityRole="button"
            accessibilityLabel="Contact support"
          >
            <Text style={styles.backToLoginText}>Contact support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backToLogin}
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="button"
            accessibilityLabel="Back to login"
          >
            <Text style={styles.backToLoginText}>Back to login</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (error) setError('');
              }}
              placeholder="your@email.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Email"
              textContentType="emailAddress"
            />
            {error ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleReset}
            activeOpacity={0.8}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Send reset link"
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            <Text style={styles.resetButtonText}>{loading ? 'Submitting...' : 'Send reset link'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    marginBottom: 24,
  },
  header: {
    marginBottom: 40,
  },
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
    color: colors.textMuted,
  },
  form: {
    gap: 24,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.bgPrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: colors.textPrimary,
  },
  resetButton: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: radius.button,
    alignItems: 'center',
  },
  resetButtonText: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.textOnAccent,
    fontSize: 14,
    fontWeight: '600',
  },
  successContainer: {
    alignItems: 'center',
    gap: 20,
    paddingTop: 40,
  },
  successText: {
    fontFamily: 'Inter_400Regular',
    color: colors.textPrimary,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 20,
  },
  backToLogin: {
    marginTop: 20,
    minHeight: 44,
    justifyContent: 'center',
  },
  backToLoginText: {
    fontFamily: 'Inter_500Medium',
    color: colors.accent,
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 4,
  },

  });
