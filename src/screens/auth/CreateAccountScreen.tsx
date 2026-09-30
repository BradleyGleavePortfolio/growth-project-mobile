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
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Typography, Spacing, Radius, Shadow } from '../../theme';
import { authApi, InvitePreview } from '../../services/api';
import { secureStorage } from '../../services/secureStorage';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import { toFriendlyAuthError, toFriendlyAppleAuthError } from '../../utils/authErrorMessage';
import { getLastKnownSignupPolicy, loadSignupPolicy, UNKNOWN_SIGNUP_POLICY } from '../../lib/signupPolicy';
import { readInviteAttachOutcome } from '../../lib/inviteAttachOutcome';
import PasteInviteCodeButton from '../../components/invite/PasteInviteCodeButton';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';
import AppleSignInButton from '../../components/AppleSignInButton';
import { signInWithApple } from '../../utils/appleAuth';
import { setUserCache } from '../../lib/userCache';
import { purgePersistedQueryCacheForAllUsers } from '../../services/queryClient';
import { authEvents } from '../../utils/authEvents';
import RoleChoice from '../../components/auth/RoleChoice';
import { isServerCoach, type IntendedRole } from '../../lib/intendedRole';
import { Colors } from '../../constants/colors';
import { typography } from '../../theme/tokens';

interface Props {
  navigation: NativeStackNavigationProp<AuthStackParamList>;
  route?: { params?: { invite_code?: string; email?: string } };
}

type Step = 'role' | 'register' | 'verify';

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

export default function CreateAccountScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Role choice (C13): people who arrive with an invite / QR code are always
  // clients and skip it; everyone else picks first.
  const arrivedWithCode = !!route?.params?.invite_code;
  const [step, setStep] = useState<Step>(arrivedWithCode ? 'register' : 'role');
  const [intendedRole, setIntendedRole] = useState<IntendedRole>('client');
  const isCoachSignup = intendedRole === 'coach' && !arrivedWithCode;
  const [name, setName] = useState('');
  const [email, setEmail] = useState<string>(() =>
    sanitisePrefillEmail(route?.params?.email),
  );
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState(route?.params?.invite_code ?? '');
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [requireInviteCode, setRequireInviteCode] = useState(
    () => (getLastKnownSignupPolicy() ?? UNKNOWN_SIGNUP_POLICY).inviteCodeRequired,
  );
  // Google is hidden until the server advertises it in `providers`.
  const [googleEnabled, setGoogleEnabled] = useState(
    () => getLastKnownSignupPolicy()?.googleEnabled === true,
  );
  // Set when signup succeeded but the backend reported
  // `invite_attached:false`. The raw reason is forwarded to the
  // RoleSelection retry step, which renders friendly copy for it.
  const [inviteAttachError, setInviteAttachError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState('');

  // Signup policy through the shared reader (audit A1): a live policy wins,
  // then the last policy fetched this session, then UNKNOWN_SIGNUP_POLICY
  // (code optional, Google hidden). A failed GET never blocks a codeless
  // email signup; the backend stays the authority on whether a code is
  // needed.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { policy } = await loadSignupPolicy(() => authApi.getSignupPolicy());
      if (!mounted) return;
      setRequireInviteCode(policy.inviteCodeRequired);
      setGoogleEnabled(policy.googleEnabled);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Auto-preview when an invite code is prefilled from a deep link.
  useEffect(() => {
    if (route?.params?.invite_code) {
      setIntendedRole('client');
      setStep((prev) => (prev === 'role' ? 'register' : prev));
      previewCode(route.params.invite_code);
    }
  }, [route?.params?.invite_code]);

  const previewCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setInvitePreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      // Prefer the public preview endpoint (no auth, returns coach branding).
      // Fall back to the legacy validate endpoint if preview is unavailable.
      // Preview only (resolves both code families); no validate fallback,
      // which would mislabel a permanent CoachProfile code as invalid.
      const res = await authApi.getInvitePreview(trimmed);
      setInvitePreview(res.data ?? null);
    } catch {
      setInvitePreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const validatePassword = (pw: string) => {
    if (pw.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(pw)) return 'Password must contain at least 1 uppercase letter';
    if (!/[0-9]/.test(pw)) return 'Password must contain at least 1 number';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) return 'Password must contain at least 1 special character';
    return null;
  };

  const handleRegister = async () => {
    if (!name || !email || !password) {
      setError('Please complete the required fields');
      return;
    }

    // A coach signup never carries a client invite code.
    const trimmedCode = isCoachSignup ? '' : inviteCode.trim();

    if (requireInviteCode && !isCoachSignup && !trimmedCode) {
      setError('An invite code from your coach is required to join.');
      return;
    }

    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }

    setLoading(true);
    setError('');

    if (trimmedCode) {
      // Audit A2: preflight through the public preview, which resolves both
      // code families (permanent CoachProfile GP- links and InviteCode rows).
      // /auth/validate-invite-code only knows InviteCode rows and rejected
      // the permanent clinic QR code. A preview failure (network) does not
      // block: signup-with-code re-checks the code authoritatively.
      try {
        const res = await authApi.getInvitePreview(trimmedCode);
        if (res.data && res.data.valid === false) {
          setError('That invite code is not valid. Please check with your coach.');
          setLoading(false);
          return;
        }
        if (res.data) setInvitePreview(res.data);
      } catch {
        // fall through to the authoritative signup call
      }
    }

    try {
      // When an invite code is present, prefer the dedicated signup-with-code
      // route so the backend can stamp coachId atomically. Falls back to the
      // legacy /auth/register for codeless flows when policy allows it.
      if (trimmedCode) {
        const res = await authApi.signupWithCode({
          name,
          email,
          password,
          phone: phone || undefined,
          invite_code: trimmedCode,
        });
        // C03: the account can be created while the coach attach fails.
        // Never continue silently; remember it so the post-verify step
        // routes to the enter-code retry screen.
        const outcome = readInviteAttachOutcome(res?.data);
        setInviteAttachError(outcome.attached === false ? outcome.reason ?? 'unknown' : null);
      } else {
        setInviteAttachError(null);
        await authApi.register({
          name,
          email,
          password,
          phone: phone || undefined,
        }, intendedRole);
      }

      await AsyncStorage.setItem('pending_email', email);
      track(AnalyticsEvents.SIGNUP_COMPLETED, {
        method: 'email',
        has_invite_code: !!trimmedCode,
      });
      setStep('verify');
    } catch (err) {
      // Map raw upstream strings (Supabase / backend / network) into quiet,
      // safe copy. Operators retain the original via console + Sentry.
      const raw = errorMessage(err) || err;
      const friendly = toFriendlyAuthError(raw);
      setError(friendly.message);
    } finally {
      setLoading(false);
    }
  };

  // After a session exists: a server-confirmed coach goes straight to the
  // app (RootNavigator mounts CoachNavigator from user.role). Everyone else,
  // including a coach request the backend did not apply yet, continues to
  // RoleSelection as before.
  const routeAfterAuth = async (
    user: { role?: unknown } | null | undefined,
    retryParams?: { inviteAttachError: string; inviteCode?: string },
  ) => {
    if (isServerCoach(user)) {
      await setUserCache(user as Parameters<typeof setUserCache>[0]);
      await purgePersistedQueryCacheForAllUsers();
      await AsyncStorage.removeItem('needs_role_selection');
      authEvents.emit();
      return;
    }
    await AsyncStorage.setItem('needs_role_selection', 'true');
    if (retryParams) navigation.replace('RoleSelection', retryParams);
    else if (isCoachSignup) navigation.replace('RoleSelection', { coachRequestPending: true });
    else navigation.replace('RoleSelection');
  };

  const handleCheckVerified = async () => {
    setVerifyLoading(true);
    setError('');

    try {
      const loginRes = await authApi.login({ email, password });
      const { access_token, refresh_token, user } = loginRes.data;

      await secureStorage.setItem('supabase_token', access_token);
      if (refresh_token) await secureStorage.setItem('supabase_refresh_token', refresh_token);
      await setUserCache(user);
      // P1-1 (PR #192): purge any orphan persisted cache blobs written under a
      // stale boot-time key before the first persistence pass for this user.
      await purgePersistedQueryCacheForAllUsers();

      await routeAfterAuth(
        user,
        inviteAttachError !== null
          ? { inviteAttachError, inviteCode: inviteCode.trim() || undefined }
          : undefined,
      );
    } catch (err) {
      const msg = errorMessage(err, '').toLowerCase();
      if (msg.includes('email') || msg.includes('confirm')) {
        setError('Email not yet verified. Open the link we sent and try again.');
      } else {
        setError('Could not sign in. Please try again.');
      }
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleAppleSignup = async () => {
    // A coach signup never carries a client invite code.
    const trimmedCode = isCoachSignup ? '' : inviteCode.trim();
    if (requireInviteCode && !isCoachSignup && !trimmedCode) {
      setError('Enter your coach invite code before continuing with Apple.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await signInWithApple({
        inviteCode: trimmedCode || undefined,
        intendedRole: trimmedCode ? 'client' : intendedRole,
      });
      if (!result.success) {
        if (result.cancelled) return;
        const friendly = toFriendlyAppleAuthError(result.error);
        if (!friendly.cancelled) {
          setError(friendly.message);
          Alert.alert('Sign in with Apple', friendly.message);
        }
        return;
      }
      await routeAfterAuth(
        result.user,
        trimmedCode && result.invite_attached === false
          ? { inviteAttachError: result.invite_attach_error ?? 'unknown', inviteCode: trimmedCode }
          : undefined,
      );
    } catch (err) {
      const friendly = toFriendlyAppleAuthError(err);
      if (!friendly.cancelled) setError(friendly.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    // A coach signup never carries a client invite code.
    const trimmedCode = isCoachSignup ? '' : inviteCode.trim();
    if (requireInviteCode && !isCoachSignup && !trimmedCode) {
      setError('Enter your coach invite code before continuing with Google.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { signInWithGoogle } = await import('../../utils/googleAuth');
      const result = await signInWithGoogle({
        inviteCode: trimmedCode || undefined,
        intendedRole: trimmedCode ? 'client' : intendedRole,
      });

      if (!result.success) {
        const friendly = toFriendlyAuthError(result.error);
        if (!friendly.cancelled) {
          setError(friendly.message);
          Alert.alert('Sign-in', friendly.message);
        }
        return;
      }

      await routeAfterAuth(result.user);
    } catch (err) {
      const friendly = toFriendlyAuthError(err);
      if (!friendly.cancelled) setError(friendly.message);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
    return (
      <View style={styles.container}>
        <View style={styles.verifyContent}>
          <Text style={styles.verifyTitle}>Check your inbox</Text>
          <Text style={styles.verifyBody}>
            We sent a verification link to{'\n'}
            <Text style={styles.emailHighlight}>{email}</Text>
          </Text>
          <Text style={styles.verifySubBody}>
            Confirm the link, then return here to continue.
          </Text>

          {inviteAttachError !== null ? (
            <View style={styles.noticeBox} testID="invite-attach-pending-notice">
              <Text style={styles.noticeText}>
                Your account was created, but we could not connect you to your coach yet. After
                you verify, we will ask for your invite code again.
              </Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.verifyButton, verifyLoading && styles.buttonDisabled]}
            onPress={handleCheckVerified}
            disabled={verifyLoading}
          >
            {verifyLoading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.verifyButtonText}>I verified my email</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setStep('register')} style={styles.backLink}>
            <Text style={styles.backLinkText}>Use a different email</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (step === 'role') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">How will you use the app?</Text>
            <Text style={styles.subtitle}>
              Have an invite code from your coach? Choose the first option and enter it on the next step.
            </Text>
          </View>
          <RoleChoice
            onChoose={(role) => {
              setIntendedRole(role);
              setError('');
              setStep('register');
            }}
          />
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
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {isCoachSignup ? 'Create your coach account' : 'Join your coach'}
          </Text>
          <Text style={styles.subtitle}>
            {isCoachSignup
              ? 'Set up your account, then your coaching practice.'
              : requireInviteCode
                ? 'Enter the invite code your coach shared to begin.'
                : 'Create your account to begin.'}
          </Text>
          {!arrivedWithCode ? (
            <Text
              style={styles.changeRole}
              accessibilityRole="button"
              accessibilityLabel="Change how you will use the app"
              testID="role-choice-change"
              onPress={() => setStep('role')}
            >
              {isCoachSignup ? 'Here to train instead?' : 'Coach clients instead?'}
            </Text>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBox} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {isCoachSignup ? null : (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              {requireInviteCode ? 'INVITE CODE' : 'INVITE CODE (OPTIONAL)'}
            </Text>
            <TextInput
              style={styles.input}
              value={inviteCode}
              onChangeText={(v) => {
                setInviteCode(v);
                setInvitePreview(null);
              }}
              onBlur={() => previewCode(inviteCode)}
              placeholder="From your coach"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Coach invite code"
              testID="invite-code-input"
            />
            <PasteInviteCodeButton
              disabled={loading}
              onCode={(code) => {
                setError('');
                setInviteCode(code);
                setInvitePreview(null);
                void previewCode(code);
              }}
              onNoCode={(message) => setError(message)}
            />
            {previewLoading ? (
              <Text style={styles.invitePreviewMuted}>Checking code…</Text>
            ) : invitePreview?.valid ? (
              <Text style={styles.invitePreviewOk}>
                You will be paired with{' '}
                {invitePreview.business_name || invitePreview.coach_name || 'your coach'}.
              </Text>
            ) : invitePreview && !invitePreview.valid ? (
              <Text style={styles.invitePreviewBad}>
                {invitePreview.reason || 'This code is not currently active.'}
              </Text>
            ) : requireInviteCode ? (
              <Text style={styles.invitePreviewMuted}>
                Don't have a code?{' '}
                <Text
                  style={styles.requestAccessLink}
                  accessibilityRole="link"
                  accessibilityLabel="Request access by email"
                  onPress={() =>
                    Linking.openURL(
                      'mailto:hello@thegrowthproject.app?subject=Request%20access%20to%20The%20Growth%20Project',
                    )
                  }
                >
                  Request access
                </Text>
                .
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>FULL NAME</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your full name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            accessibilityLabel="Full name"
            textContentType="name"
          />
        </View>

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
            textContentType="emailAddress"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Min 8 chars, 1 upper, 1 number, 1 special"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            accessibilityLabel="Password"
            accessibilityHint="Minimum 8 characters, 1 uppercase, 1 number, 1 special"
            textContentType="newPassword"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>PHONE (OPTIONAL)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Your phone number"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            accessibilityLabel="Phone number, optional"
            textContentType="telephoneNumber"
          />
        </View>

        <TouchableOpacity
          style={[styles.registerButton, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Create account"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.registerButtonText}>Create account</Text>
          )}
        </TouchableOpacity>

        {googleEnabled && (
          <>
            <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleSignup}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Text style={styles.googleG}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </TouchableOpacity>
          </>
        )}


        {/* Apple Sign-In — required by App Store policy when any other
            third-party sign-in is offered. Renders nothing on Android or
            unsupported iOS configurations. */}
        <View style={styles.appleButtonWrap}>
          <AppleSignInButton onPress={handleAppleSignup} label="SIGN_UP" />
        </View>

        <View style={styles.signupRow}>
          <Text style={styles.signupText}>Already have an account? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="link"
            accessibilityLabel="Sign in"
          >
            <Text style={styles.signupLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: Spacing.lg },
  header: { marginTop: Spacing.xl, marginBottom: Spacing.xl },
  title: { ...Typography.h1, marginBottom: Spacing.xs },
  subtitle: { ...Typography.body },
  changeRole: { ...Typography.body, color: colors.primary, marginTop: Spacing.sm },
  errorBox: {
    backgroundColor: Colors.noticeCriticalBg,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.error,
  },
  errorText: { color: colors.error, fontSize: 14, fontFamily: 'Inter_400Regular' },
  noticeBox: {
    backgroundColor: colors.surface,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
  },
  noticeText: { ...typography.bodySmall, color: colors.dark },
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
  invitePreviewOk: { fontSize: 13, color: colors.primary, marginTop: 6 },
  invitePreviewBad: { fontSize: 13, color: colors.error, marginTop: 6 },
  invitePreviewMuted: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  requestAccessLink: { color: colors.primary, textDecorationLine: 'underline' },
  registerButton: {
    backgroundColor: colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
    ...Shadow.button,
  },
  buttonDisabled: { opacity: 0.6 },
  registerButtonText: { ...Typography.button, color: colors.white },
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
  googleG: { fontFamily: 'Inter_600SemiBold', fontSize: 16, fontWeight: '600', marginRight: Spacing.sm, color: colors.dark },
  googleButtonText: { ...Typography.button, color: colors.dark },
  appleButtonWrap: { marginTop: Spacing.md, minHeight: 48 },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  signupText: { color: colors.textMuted, fontSize: 15 },
  signupLink: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  verifyContent: {
    flex: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyTitle: { ...Typography.h2, marginBottom: Spacing.md, textAlign: 'center' },
  verifyBody: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    lineHeight: 24,
  },
  emailHighlight: { color: colors.primary, fontWeight: '600' },
  verifySubBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  verifyButton: {
    backgroundColor: colors.primary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    width: '100%',
    ...Shadow.button,
  },
  verifyButtonText: { ...Typography.button, color: colors.white },
  backLink: { marginTop: Spacing.lg },
  backLinkText: { color: colors.textMuted, fontSize: 14 },

  });
