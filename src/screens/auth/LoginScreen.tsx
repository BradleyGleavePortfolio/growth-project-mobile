import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  // TouchableOpacity retained for auth buttons — safe pattern
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Typography, Spacing, Radius, Shadow } from '../../theme';
import { authApi } from '../../services/api';
import { secureStorage } from '../../services/secureStorage';
import { authEvents } from '../../utils/authEvents';
import { track, identify } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import { toFriendlyAuthError } from '../../utils/authErrorMessage';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import type { NavigationProp, ParamListBase, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';
import AppleSignInButton from '../../components/AppleSignInButton';
import { signInWithApple } from '../../utils/appleAuth';
import { setUserCache } from '../../lib/userCache';
import { purgePersistedQueryCacheForAllUsers } from '../../services/queryClient';
import { Colors } from '../../constants/colors';

interface Props {
  navigation: NativeStackNavigationProp<AuthStackParamList>;
  route?: RouteProp<AuthStackParamList, 'Login'>;
}

/**
 * Conservative sanitiser for an inbound prefilled email. Strips
 * whitespace and any non-printable characters, then caps at the
 * RFC 5321 limit so a crafted deep link can't paste a 10kB blob
 * into the email field.
 */
function sanitisePrefillEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (let i = 0; i < raw.length && out.length < 254; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) continue;
    if (c === 0x20) continue;
    out += raw[i];
  }
  return out.trim();
}

export default function LoginScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState<string>(() =>
    sanitisePrefillEmail(route?.params?.email),
  );
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authApi.login({ email, password });
      const { access_token, refresh_token, user } = response.data;

      // Store JWT tokens in SecureStore (not AsyncStorage) for all subsequent API calls.
      // Security: SecureStore uses iOS Keychain / Android Keystore so tokens aren't
      // readable from the plain app sandbox.
      await secureStorage.setItem('supabase_token', access_token);
      if (refresh_token) await secureStorage.setItem('supabase_refresh_token', refresh_token);
      setUserCache(user);
      // P1-1 (PR #192): the asyncStoragePersister key is resolved once at
      // module load (boot-time user id). Purge ALL persisted cache blobs here
      // so any orphan blob written under a stale key by a prior session is
      // removed before the first persistence pass writes new data for this user.
      await purgePersistedQueryCacheForAllUsers();

      // Restore onboarding status from backend profile — prevents re-onboarding on re-login
      if (user.profile?.onboarding_completed) {
        await AsyncStorage.setItem('onboarding_complete', 'true');
      }

      // Psych Report #4: Analytics — identify + signed_in event
      identify(user.id, { role: user.role });
      track(AnalyticsEvents.LOGIN_COMPLETED, { method: 'email' });

      // Fire auth event — RootNavigator will re-check AsyncStorage and navigate
      authEvents.emit();
    } catch (err) {
      // Map any upstream string (Supabase, axios, or backend) into a quiet,
      // safe line. Operators still get the raw error in console / Sentry.
      const raw = errorMessage(err) || err;
      const friendly = toFriendlyAuthError(raw);
      setError(friendly.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError('');
    try {
      const { signInWithGoogle } = await import('../../utils/googleAuth');
      const result = await signInWithGoogle();

      if (!result.success) {
        // Map raw OAuth strings to quiet safe copy. Cancellation stays silent.
        const friendly = toFriendlyAuthError(result.error);
        if (!friendly.cancelled) {
          setError(friendly.message);
          Alert.alert('Sign-in', friendly.message);
        }
        return;
      }

      if (result.is_new_user || !result.user?.role) {
        await AsyncStorage.setItem('needs_role_selection', 'true');
        navigation.replace('RoleSelection');
      } else {
        // Psych Report #4: Analytics
        if (result.user?.id) identify(result.user.id, { role: result.user.role });
        track(AnalyticsEvents.LOGIN_COMPLETED, { method: 'google' });
        authEvents.emit();
      }
    } catch (err) {
      const friendly = toFriendlyAuthError(err);
      if (!friendly.cancelled) setError(friendly.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setAppleLoading(true);
    setError('');
    try {
      const result = await signInWithApple();

      if (!result.success) {
        if (result.cancelled) return;
        const friendly = toFriendlyAuthError(result.error);
        if (!friendly.cancelled) {
          setError(friendly.message);
          Alert.alert('Sign-in', friendly.message);
        }
        return;
      }

      if (result.is_new_user || !result.user?.role) {
        await AsyncStorage.setItem('needs_role_selection', 'true');
        navigation.replace('RoleSelection');
      } else {
        if (result.user?.id) identify(result.user.id, { role: result.user.role });
        track(AnalyticsEvents.LOGIN_COMPLETED, { method: 'apple' });
        authEvents.emit();
      }
    } catch (err) {
      const friendly = toFriendlyAuthError(err);
      if (!friendly.cancelled) setError(friendly.message);
    } finally {
      setAppleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        {/* Round 3: accessibilityRole="header" for VoiceOver/TalkBack */}
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">Welcome back.</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
        </View>

        {/* Error message */}
        {error ? (
          <View style={styles.errorBox} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Email field */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Email"
            accessibilityHint="Enter your email address"
            textContentType="emailAddress"
          />
        </View>

        {/* Password field */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            accessibilityLabel="Password"
            accessibilityHint="Enter your password"
            textContentType="password"
          />
        </View>

        {/* Forgot password */}
        <TouchableOpacity
          onPress={() => navigation.navigate('ForgotPassword')}
          accessibilityRole="button"
          accessibilityLabel="Forgot password"
          accessibilityHint="Opens password reset flow"
        >
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>

        {/* Login button */}
        {/* Sign In — success haptic fires in handleLogin after successful auth */}
        <TouchableOpacity
          style={[styles.loginButton, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.loginButtonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google Sign-In button */}
        <TouchableOpacity
          style={[styles.googleButton, googleLoading && styles.buttonDisabled]}
          onPress={handleGoogleLogin}
          disabled={googleLoading}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          accessibilityState={{ disabled: googleLoading, busy: googleLoading }}
        >
          {googleLoading ? (
            <ActivityIndicator color={colors.dark} />
          ) : (
            <>
              <Text style={styles.googleG}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Apple Sign-In — required by App Store when any third-party
            sign-in is offered. AppleSignInButton renders nothing on Android
            or on iOS devices that don't support Apple sign-in (very old
            simulators, accounts without Apple ID). */}
        <View style={styles.appleButtonWrap} pointerEvents={appleLoading ? 'none' : 'auto'}>
          <AppleSignInButton onPress={handleAppleLogin} label="SIGN_IN" />
          {appleLoading ? (
            <ActivityIndicator color={colors.dark} style={styles.appleSpinner} />
          ) : null}
        </View>

        {/* Sign up link */}
        <View style={styles.signupRow}>
          <Text style={styles.signupText}>Don't have an account? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('CreateAccount')}
            accessibilityRole="link"
            accessibilityLabel="Sign up"
            accessibilityHint="Opens account creation"
          >
            <Text style={styles.signupLink}>Sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: Spacing.lg, justifyContent: 'center' },
  header: { marginBottom: Spacing.xl },
  title: { ...Typography.h1, marginBottom: Spacing.xs },
  subtitle: { ...Typography.body },
  errorBox: {
    backgroundColor: Colors.noticeCriticalBg,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.error,
  },
  errorText: { color: colors.error, fontSize: 14, fontFamily: 'Inter_400Regular' },
  inputGroup: { marginBottom: Spacing.md },
  inputLabel: { ...Typography.label, marginBottom: Spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: 16,
    color: colors.dark,
    ...Shadow.card,
  },
  forgotText: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'right',
    marginBottom: Spacing.lg,
  },
  loginButton: {
    backgroundColor: colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    ...Shadow.button,
  },
  buttonDisabled: { opacity: 0.6 },
  loginButtonText: { ...Typography.button, color: colors.white },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { marginHorizontal: Spacing.sm, color: colors.textMuted, fontSize: 14 },
  googleButton: {
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...Shadow.card,
  },
  googleG: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    fontWeight: '600',
    marginRight: Spacing.sm,
    color: colors.dark,
  },
  googleButtonText: { ...Typography.button, color: colors.dark },
  appleButtonWrap: {
    marginTop: Spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  appleSpinner: { position: 'absolute', alignSelf: 'center' },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.xl,
  },
  signupText: { color: colors.textMuted, fontSize: 15 },
  signupLink: { color: colors.primary, fontSize: 15, fontWeight: '600' },

  });
