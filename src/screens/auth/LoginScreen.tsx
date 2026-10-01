import React, { useEffect, useState, useMemo } from 'react';
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
import { toFriendlyAuthError, toFriendlyAppleAuthError } from '../../utils/authErrorMessage';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import type { NavigationProp, ParamListBase, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';
import AppleSignInButton from '../../components/AppleSignInButton';
import { signInWithApple } from '../../utils/appleAuth';
// Static import (was a dynamic `import()`): Metro bundles the module either
// way, and a static import lets the Google path be exercised in Jest.
import { signInWithGoogle } from '../../utils/googleAuth';
import { setUserCache } from '../../lib/userCache';
import { purgePersistedQueryCacheForAllUsers } from '../../services/queryClient';
import { Colors } from '../../constants/colors';
import { getLastKnownSignupPolicy, loadSignupPolicy } from '../../lib/signupPolicy';
import {
  clearSignupRoleNotice,
  setSignupRoleNotice,
  signupRoleNoticeMessage,
} from '../../lib/signupRoleNotice';
import {
  reconcileCoachAttempt,
  resolveUnconfirmedCoachSignup,
  type CoachSignupMethod,
} from '../../lib/coachSignupAttempt';

// #306 r4 (Sol B2-R3): a sign-in that recovered the account of an earlier,
// unconfirmed coach signup, and the server says it is not a coach. The
// notice is shown here and must be acknowledged before the client flow.
interface CoachAttemptRecovery {
  method: CoachSignupMethod;
  identity?: string;
  priorNeedsRoleSelection: string | null;
  proceed: () => Promise<void>;
}

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
  // B3: Google only when the shared signup policy advertises it (hidden
  // while unknown), same reader as CreateAccount.
  const [googleEnabled, setGoogleEnabled] = useState(
    () => getLastKnownSignupPolicy()?.googleEnabled === true,
  );
  // C13: while the server offers a role choice at account creation, the
  // first Sign in with Apple / Google for a provider account CREATES the
  // account (as a client) and fixes its role for good. The role question
  // must therefore be answered before that round-trip, and this screen has
  // not asked it. So, when `roleChoice` is on, the provider buttons first
  // ask whether an account already exists: new people go to CreateAccount
  // (role step first), returning people continue. `null` = policy unknown.
  const [roleChoiceEnabled, setRoleChoiceEnabled] = useState<boolean | null>(
    () => getLastKnownSignupPolicy()?.roleChoice ?? null,
  );
  const [pendingProvider, setPendingProvider] = useState<'apple' | 'google' | null>(null);
  const [recovery, setRecovery] = useState<CoachAttemptRecovery | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  // Shared outcome reconciliation (lib/coachSignupAttempt), the same rule as
  // CreateAccount: when this sign-in matches an unconfirmed coach attempt and
  // the server answered with a non-coach account, hold the client flow and
  // show the "coach sign-up was not applied" notice first. The notice is
  // persisted and `needs_role_selection` is set while it is shown, so a cold
  // start before it is acknowledged does not enter the client app. Anything
  // else proceeds exactly as before.
  const continueAfterCoachAttemptCheck = async (
    method: CoachSignupMethod,
    user: { role?: unknown; email?: unknown } | null | undefined,
    opts: { emailHint?: string; isNewUser?: boolean },
    proceed: () => Promise<void>,
  ) => {
    const notice = await reconcileCoachAttempt(method, user, opts);
    if (!notice) {
      await proceed();
      return;
    }
    const priorNeedsRoleSelection = await AsyncStorage.getItem('needs_role_selection').catch(() => null);
    await setSignupRoleNotice(notice);
    await AsyncStorage.setItem('needs_role_selection', 'true').catch(() => undefined);
    const identity =
      typeof user?.email === 'string' && user.email ? user.email : opts.emailHint || undefined;
    setRecovery({ method, identity, priorNeedsRoleSelection, proceed });
  };

  const acknowledgeRecovery = async () => {
    if (!recovery || recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      if (recovery.priorNeedsRoleSelection === null) await AsyncStorage.removeItem('needs_role_selection');
      else await AsyncStorage.setItem('needs_role_selection', recovery.priorNeedsRoleSelection);
      await clearSignupRoleNotice();
      await resolveUnconfirmedCoachSignup(recovery.method, recovery.identity);
      const { proceed } = recovery;
      setRecovery(null);
      await proceed();
    } finally {
      setRecoveryBusy(false);
    }
  };
  useEffect(() => {
    let mounted = true;
    void loadSignupPolicy(() => authApi.getSignupPolicy()).then(({ policy }) => {
      if (!mounted) return;
      setGoogleEnabled(policy.googleEnabled);
      setRoleChoiceEnabled(policy.roleChoice);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // True when the provider round-trip must wait for the "already have an
  // account" confirmation. The policy being unknown counts as "ask", because
  // proceeding could create an account whose role was never chosen.
  const mustConfirmExistingAccount = (confirmed: boolean) =>
    !confirmed && roleChoiceEnabled !== false;

  // The provider account had no user row, so the backend created a client
  // account without a role question. Say so; never continue silently.
  const noteNewAccountFromSignIn = async () => {
    await setSignupRoleNotice('new_account_from_sign_in');
  };

  const handleLogin = async () => {
    // Surrounding spaces (keyboard autocomplete) are never part of the
    // address; case is left as typed (legacy rows may be mixed case).
    const typedEmail = email.trim();
    if (!typedEmail || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authApi.login({ email: typedEmail, password });
      const { access_token, refresh_token, user } = response.data;

      // Store JWT tokens in SecureStore (not AsyncStorage) for all subsequent API calls.
      // Security: SecureStore uses iOS Keychain / Android Keystore so tokens aren't
      // readable from the plain app sandbox.
      await secureStorage.setItem('supabase_token', access_token);
      if (refresh_token) await secureStorage.setItem('supabase_refresh_token', refresh_token);
      await setUserCache(user);
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
      // (after the coach-attempt notice, when one applies).
      await continueAfterCoachAttemptCheck('email', user, { emailHint: typedEmail }, async () => {
        authEvents.emit();
      });
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

  const handleGoogleLogin = async (confirmed = false) => {
    if (mustConfirmExistingAccount(confirmed)) {
      setError('');
      setPendingProvider('google');
      return;
    }
    setPendingProvider(null);
    setGoogleLoading(true);
    setError('');
    try {
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

      const proceedGoogle = async () => {
        if (result.is_new_user || !result.user?.role) {
          await AsyncStorage.setItem('needs_role_selection', 'true');
          // Same predicate as the confirm panel (unknown policy counts), and
          // only when the server actually answered: the legacy fallback
          // (`server_confirmed: false`) proves nothing about a new account.
          if (result.is_new_user && result.server_confirmed !== false && roleChoiceEnabled !== false) {
            await noteNewAccountFromSignIn();
            navigation.replace('RoleSelection', { signupNotice: 'new_account_from_sign_in' });
          } else {
            navigation.replace('RoleSelection');
          }
        } else {
          // P1-1 (PR #192 INF-1): purge any orphan persisted cache blobs before
          // this user's first persistence pass, matching the email sign-in path.
          if (result.user) await setUserCache(result.user);
          await purgePersistedQueryCacheForAllUsers();
          // Psych Report #4: Analytics
          if (result.user?.id) identify(result.user.id, { role: result.user.role });
          track(AnalyticsEvents.LOGIN_COMPLETED, { method: 'google' });
          authEvents.emit();
        }
      };
      // Only a server answer can resolve (or reveal) an earlier unconfirmed
      // coach attempt; the legacy fallback is not one.
      if (result.server_confirmed === false) await proceedGoogle();
      else
        await continueAfterCoachAttemptCheck(
          'google',
          result.user,
          { isNewUser: result.is_new_user },
          proceedGoogle,
        );
    } catch (err) {
      const friendly = toFriendlyAuthError(err);
      if (!friendly.cancelled) setError(friendly.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleLogin = async (confirmed = false) => {
    if (mustConfirmExistingAccount(confirmed)) {
      setError('');
      setPendingProvider('apple');
      return;
    }
    setPendingProvider(null);
    setAppleLoading(true);
    setError('');
    try {
      const result = await signInWithApple();

      if (!result.success) {
        if (result.cancelled) return;
        const friendly = toFriendlyAppleAuthError(result.error);
        if (!friendly.cancelled) {
          setError(friendly.message);
          Alert.alert('Sign in with Apple', friendly.message);
        }
        return;
      }

      const proceedApple = async () => {
        if (result.is_new_user || !result.user?.role) {
          await AsyncStorage.setItem('needs_role_selection', 'true');
          // Same predicate as the confirm panel: an unknown policy counts.
          if (result.is_new_user && roleChoiceEnabled !== false) {
            await noteNewAccountFromSignIn();
            navigation.replace('RoleSelection', { signupNotice: 'new_account_from_sign_in' });
          } else {
            navigation.replace('RoleSelection');
          }
        } else {
          // P1-1 (PR #192 INF-1): purge any orphan persisted cache blobs before
          // this user's first persistence pass, matching the email sign-in path.
          if (result.user) await setUserCache(result.user);
          await purgePersistedQueryCacheForAllUsers();
          if (result.user?.id) identify(result.user.id, { role: result.user.role });
          track(AnalyticsEvents.LOGIN_COMPLETED, { method: 'apple' });
          authEvents.emit();
        }
      };
      await continueAfterCoachAttemptCheck(
        'apple',
        result.user,
        { isNewUser: result.is_new_user },
        proceedApple,
      );
    } catch (err) {
      const friendly = toFriendlyAppleAuthError(err);
      if (!friendly.cancelled) setError(friendly.message);
    } finally {
      setAppleLoading(false);
    }
  };

  if (recovery) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Coach sign-up was not applied
            </Text>
          </View>
          <View style={styles.confirmBox} accessible accessibilityRole="alert" testID="login-coach-retry-notice">
            <Text style={styles.confirmBody}>{signupRoleNoticeMessage('coach_retry_not_applied')}</Text>
            <TouchableOpacity
              style={[styles.confirmPrimary, recoveryBusy && styles.buttonDisabled]}
              onPress={acknowledgeRecovery}
              disabled={recoveryBusy}
              accessibilityRole="button"
              accessibilityLabel="Continue as a client"
              accessibilityState={{ disabled: recoveryBusy, busy: recoveryBusy }}
              testID="login-coach-retry-continue"
            >
              <Text style={styles.confirmPrimaryText}>Continue as a client</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmSecondary}
              onPress={() => navigation.navigate('SupportInbox')}
              accessibilityRole="link"
              accessibilityLabel="Contact support"
              testID="login-coach-retry-support"
            >
              <Text style={styles.confirmSecondaryText}>Contact support</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

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

        {googleEnabled ? (
          <>
            {/* Divider */}
            <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Google Sign-In button */}
            <TouchableOpacity
              style={[styles.googleButton, googleLoading && styles.buttonDisabled]}
              onPress={() => handleGoogleLogin()}
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
          </>
        ) : null}

        {/* Apple Sign-In — required by App Store when any third-party
            sign-in is offered. AppleSignInButton renders nothing on Android
            or on iOS devices that don't support Apple sign-in (very old
            simulators, accounts without Apple ID). */}
        <View style={styles.appleButtonWrap} pointerEvents={appleLoading ? 'none' : 'auto'}>
          <AppleSignInButton onPress={() => handleAppleLogin()} label="SIGN_IN" />
          {appleLoading ? (
            <ActivityIndicator color={colors.dark} style={styles.appleSpinner} />
          ) : null}
        </View>

        {/* C13: role choice is on, so a first provider sign-in would create
            an account before the role question. Ask first. */}
        {pendingProvider ? (
          <View style={styles.confirmBox} accessible accessibilityRole="alert" testID="existing-account-confirm">
            <Text style={styles.confirmTitle}>Already have an account?</Text>
            <Text style={styles.confirmBody}>
              {pendingProvider === 'apple' ? 'Sign in with Apple' : 'Continue with Google'} creates a new
              account the first time. If you are new here, create your account first so you can choose how
              you will use the app.
            </Text>
            <TouchableOpacity
              style={styles.confirmPrimary}
              onPress={() => (pendingProvider === 'apple' ? handleAppleLogin(true) : handleGoogleLogin(true))}
              accessibilityRole="button"
              accessibilityLabel="Yes, sign me in"
              testID="existing-account-continue"
            >
              <Text style={styles.confirmPrimaryText}>Yes, sign me in</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmSecondary}
              onPress={() => {
                setPendingProvider(null);
                navigation.navigate('CreateAccount');
              }}
              accessibilityRole="button"
              accessibilityLabel="I am new, create an account"
              testID="existing-account-create"
            >
              <Text style={styles.confirmSecondaryText}>I am new, create an account</Text>
            </TouchableOpacity>
          </View>
        ) : null}

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
  confirmBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: Radius.sm,
    backgroundColor: colors.surface,
  },
  confirmTitle: { ...Typography.h3, marginBottom: Spacing.xs },
  confirmBody: { ...Typography.body, color: colors.textSecondary, marginBottom: Spacing.md },
  confirmPrimary: {
    backgroundColor: colors.primary,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    alignItems: 'center',
  },
  confirmPrimaryText: { ...Typography.button, color: colors.white },
  confirmSecondary: { alignItems: 'center', paddingVertical: Spacing.md },
  confirmSecondaryText: { ...Typography.body, color: colors.primary },
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
