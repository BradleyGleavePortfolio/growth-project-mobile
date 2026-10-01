import React, { useEffect, useState, useMemo, useRef } from 'react';
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
// Static import (was a dynamic `import()`): Metro bundles the module either
// way, and a static import lets the Google path be exercised in Jest.
import { signInWithGoogle } from '../../utils/googleAuth';
import { setUserCache } from '../../lib/userCache';
import { purgePersistedQueryCacheForAllUsers } from '../../services/queryClient';
import { authEvents } from '../../utils/authEvents';
import RoleChoice from '../../components/auth/RoleChoice';
import {
  COACH_SIGNUP_UNAVAILABLE,
  COACH_SIGNUP_UNAVAILABLE_MESSAGE,
  COACH_SIGNUP_UNCONFIRMED,
  COACH_SIGNUP_UNCONFIRMED_MESSAGE,
  intendedRoleForRequest,
  isCoachSignupUnavailable,
  isServerCoach,
  type IntendedRole,
} from '../../lib/intendedRole';
import {
  clearSignupRoleNotice,
  setSignupRoleNotice,
  signupRoleNoticeMessage,
  type SignupRoleNoticeKind,
} from '../../lib/signupRoleNotice';
import { Colors } from '../../constants/colors';
import { typography } from '../../theme/tokens';

interface Props {
  navigation: NativeStackNavigationProp<AuthStackParamList>;
  route?: { params?: { invite_code?: string; email?: string } };
}

// 'policy': the live signup policy has not answered yet and nothing is
// cached, so the screen does not know whether to ask the role question.
// The form is held back until the answer (or the UNKNOWN fallback) arrives.
// 'coach-unavailable': the user chose coach, then the live policy said role
// choice is off. Nothing has been created; the user is told and must choose
// explicitly (client instead, or check again). Never switched silently.
type Step = 'policy' | 'role' | 'register' | 'verify' | 'coach-unavailable';

function firstStep(arrivedWithCode: boolean, roleChoice: boolean | null): Step {
  if (arrivedWithCode) return 'register';
  if (roleChoice === null) return 'policy';
  return roleChoice ? 'role' : 'register';
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

export default function CreateAccountScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Role choice (C13): asked only when the live signup policy advertises
  // `role_choice: true` (backend #597). People who arrive with an invite /
  // QR code are always clients and skip it; everyone else picks first.
  // `null` = policy not known yet (no live answer, nothing cached).
  const arrivedWithCode = !!route?.params?.invite_code;
  const [roleChoiceEnabled, setRoleChoiceEnabled] = useState<boolean | null>(
    () => getLastKnownSignupPolicy()?.roleChoice ?? null,
  );
  const [step, setStep] = useState<Step>(() => firstStep(arrivedWithCode, roleChoiceEnabled));
  const [intendedRole, setIntendedRole] = useState<IntendedRole>('client');
  const [name, setName] = useState('');
  const [email, setEmail] = useState<string>(() =>
    sanitisePrefillEmail(route?.params?.email),
  );
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState(route?.params?.invite_code ?? '');
  // A typed or pasted code also means client: while the field has content the
  // coach option is not offered, so the code is never silently dropped.
  const hasTypedCode = inviteCode.trim().length > 0;
  const isCoachSignup =
    roleChoiceEnabled === true && intendedRole === 'coach' && !arrivedWithCode && !hasTypedCode;
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
  // C13: the user chose coach and /auth/register answered with a non-coach
  // `role` (kill switch flipped between the policy read and the request).
  // The account exists as a client; the verify step says so and RoleSelection
  // repeats it.
  const [coachRequestNotApplied, setCoachRequestNotApplied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState('');
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [recheckNote, setRecheckNote] = useState('');

  // The policy effect below runs once and resolves later; it reads the
  // current choice and step through refs, not the mount-time closure.
  const isCoachSignupRef = useRef(isCoachSignup);
  isCoachSignupRef.current = isCoachSignup;
  const stepRef = useRef(step);
  stepRef.current = step;

  // Drop a provider session whose role outcome is not proven, so nothing on
  // the device claims an account that the server did not confirm.
  const dropUnconfirmedSession = async () => {
    for (const drop of [
      () => secureStorage.removeItem('supabase_token'),
      () => secureStorage.removeItem('supabase_refresh_token'),
      () => AsyncStorage.removeItem('user_data'),
    ]) {
      try {
        await drop();
      } catch {
        // best effort; the error copy is shown regardless
      }
    }
  };

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
      // #306 r2 (B2): the cached policy offered the choice, the user chose
      // coach, and the live policy now says role choice is off. Keep the
      // coach intent, say so, and require an explicit choice. Never fall
      // through to a client registration the user did not choose.
      const coachChoiceWithdrawn =
        !policy.roleChoice &&
        isCoachSignupRef.current &&
        stepRef.current !== 'verify' &&
        stepRef.current !== 'policy';
      setRoleChoiceEnabled(policy.roleChoice);
      if (coachChoiceWithdrawn) {
        setError('');
        setStep('coach-unavailable');
        return;
      }
      setStep((prev) => {
        if (prev === 'policy') return firstStep(arrivedWithCode, policy.roleChoice);
        // Cached policy said yes, live policy says no, and no coach choice
        // was made: there is no choice to make, so continue as a client.
        if (prev === 'role' && !policy.roleChoice) return 'register';
        return prev;
      });
      if (!policy.roleChoice) setIntendedRole('client');
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Auto-preview when an invite code is prefilled from a deep link.
  useEffect(() => {
    if (route?.params?.invite_code) {
      // A join link / QR code always means client and skips the choice,
      // even if it arrives while the coach form is open.
      setIntendedRole('client');
      setInviteCode(route.params.invite_code);
      setStep((prev) => (prev === 'role' || prev === 'policy' ? 'register' : prev));
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
    if (step === 'coach-unavailable') return;
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
        const res = await authApi.register(
          {
            name,
            email,
            password,
            phone: phone || undefined,
          },
          intendedRoleForRequest(roleChoiceEnabled === true, intendedRole, false),
        );
        // Backend #597 returns the role the account was created with. A
        // coach request the server did not apply is said plainly, never
        // treated as a normal client signup.
        const createdRole = res?.data?.role;
        const notApplied = isCoachSignup && typeof createdRole === 'string' && createdRole !== 'coach';
        setCoachRequestNotApplied(notApplied);
        if (notApplied) await setSignupRoleNotice('coach_request_not_applied');
      }

      await AsyncStorage.setItem('pending_email', email);
      track(AnalyticsEvents.SIGNUP_COMPLETED, {
        method: 'email',
        has_invite_code: !!trimmedCode,
        ...(isCoachSignup ? { intended_role: 'coach' } : {}),
      });
      setStep('verify');
    } catch (err) {
      if (isCoachSignupUnavailable(err)) {
        // No account was created (the server rejected the body before any
        // handler ran). Never fall back to a client account here.
        setError(COACH_SIGNUP_UNAVAILABLE_MESSAGE);
        return;
      }
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
  // app (RootNavigator mounts CoachNavigator from user.role). Everyone else
  // continues to RoleSelection. A coach request the server did not apply is
  // never silent: the notice is passed as a param AND persisted
  // (lib/signupRoleNotice) so RoleSelection shows it even after a remount.
  // `isNewUser === false` means the provider account already existed; the
  // role choice did not apply and we say that instead.
  const routeAfterAuth = async (
    user: { role?: unknown } | null | undefined,
    opts: {
      retryParams?: { inviteAttachError: string; inviteCode?: string };
      isNewUser?: boolean;
    } = {},
  ) => {
    // #306 r2 (B1): a coach request is reported only from a server-returned
    // role. A missing role proves nothing, so the user is told the outcome is
    // unconfirmed and the provisional session is dropped; never "created as
    // a client account".
    if (isCoachSignup && typeof user?.role !== 'string') {
      await dropUnconfirmedSession();
      setError(COACH_SIGNUP_UNCONFIRMED_MESSAGE);
      return;
    }
    if (isServerCoach(user)) {
      await setUserCache(user as Parameters<typeof setUserCache>[0]);
      await purgePersistedQueryCacheForAllUsers();
      await AsyncStorage.removeItem('needs_role_selection');
      await clearSignupRoleNotice();
      authEvents.emit();
      return;
    }
    await AsyncStorage.setItem('needs_role_selection', 'true');
    let signupNotice: SignupRoleNoticeKind | undefined;
    if (isCoachSignup) {
      signupNotice = opts.isNewUser === false ? 'existing_account' : 'coach_request_not_applied';
      await setSignupRoleNotice(signupNotice);
    }
    const params = { ...(opts.retryParams ?? {}), ...(signupNotice ? { signupNotice } : {}) };
    if (Object.keys(params).length > 0) navigation.replace('RoleSelection', params);
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

      await routeAfterAuth(user, {
        retryParams:
          inviteAttachError !== null
            ? { inviteAttachError, inviteCode: inviteCode.trim() || undefined }
            : undefined,
      });
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
    if (step === 'coach-unavailable') return;
    // A coach signup never carries a client invite code.
    const trimmedCode = isCoachSignup ? '' : inviteCode.trim();
    if (requireInviteCode && !isCoachSignup && !trimmedCode) {
      setError('Enter your coach invite code before continuing with Apple.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // The role question was answered before this round-trip; the backend
      // fixes the role when it inserts the User row, so this is the only
      // moment `intended_role` can matter.
      const result = await signInWithApple({
        inviteCode: trimmedCode || undefined,
        intendedRole: intendedRoleForRequest(roleChoiceEnabled === true, intendedRole, !!trimmedCode),
      });
      if (!result.success) {
        if (result.cancelled) return;
        if (result.error_code === COACH_SIGNUP_UNAVAILABLE) {
          setError(COACH_SIGNUP_UNAVAILABLE_MESSAGE);
          return;
        }
        const friendly = toFriendlyAppleAuthError(result.error);
        if (!friendly.cancelled) {
          setError(friendly.message);
          Alert.alert('Sign in with Apple', friendly.message);
        }
        return;
      }
      await routeAfterAuth(result.user, {
        isNewUser: result.is_new_user,
        retryParams:
          trimmedCode && result.invite_attached === false
            ? { inviteAttachError: result.invite_attach_error ?? 'unknown', inviteCode: trimmedCode }
            : undefined,
      });
    } catch (err) {
      if (isCoachSignupUnavailable(err)) {
        setError(COACH_SIGNUP_UNAVAILABLE_MESSAGE);
        return;
      }
      const friendly = toFriendlyAppleAuthError(err);
      if (!friendly.cancelled) setError(friendly.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    if (step === 'coach-unavailable') return;
    // A coach signup never carries a client invite code.
    const trimmedCode = isCoachSignup ? '' : inviteCode.trim();
    if (requireInviteCode && !isCoachSignup && !trimmedCode) {
      setError('Enter your coach invite code before continuing with Google.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await signInWithGoogle({
        inviteCode: trimmedCode || undefined,
        intendedRole: intendedRoleForRequest(roleChoiceEnabled === true, intendedRole, !!trimmedCode),
      });

      if (!result.success) {
        if (result.error_code === COACH_SIGNUP_UNAVAILABLE) {
          setError(COACH_SIGNUP_UNAVAILABLE_MESSAGE);
          return;
        }
        if (result.error_code === COACH_SIGNUP_UNCONFIRMED) {
          setError(COACH_SIGNUP_UNCONFIRMED_MESSAGE);
          return;
        }
        const friendly = toFriendlyAuthError(result.error);
        if (!friendly.cancelled) {
          setError(friendly.message);
          Alert.alert('Sign-in', friendly.message);
        }
        return;
      }

      // A typed code the backend did not attach is carried to the retry
      // step with the code prefilled instead of being dropped.
      await routeAfterAuth(result.user, {
        isNewUser: result.is_new_user,
        retryParams:
          trimmedCode && result.invite_attached === false
            ? { inviteAttachError: 'unknown', inviteCode: result.invite_code ?? trimmedCode }
            : undefined,
      });
    } catch (err) {
      if (isCoachSignupUnavailable(err)) {
        setError(COACH_SIGNUP_UNAVAILABLE_MESSAGE);
        return;
      }
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

          {coachRequestNotApplied ? (
            <View style={styles.noticeBox} testID="coach-request-not-applied-notice">
              <Text style={styles.noticeText}>{signupRoleNoticeMessage('coach_request_not_applied')}</Text>
              <Text
                style={styles.supportLink}
                accessibilityRole="link"
                accessibilityLabel="Contact support"
                testID="coach-request-not-applied-support"
                onPress={() => navigation.navigate('SupportInbox')}
              >
                Contact support
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

  if (step === 'policy') {
    return (
      <View style={styles.container} testID="signup-policy-loading">
        <View style={styles.verifyContent}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.verifySubBody}>Preparing sign-up.</Text>
        </View>
      </View>
    );
  }

  const recheckPolicy = async () => {
    setRecheckLoading(true);
    setRecheckNote('');
    try {
      const { policy } = await loadSignupPolicy(() => authApi.getSignupPolicy());
      setRequireInviteCode(policy.inviteCodeRequired);
      setGoogleEnabled(policy.googleEnabled);
      setRoleChoiceEnabled(policy.roleChoice);
      if (policy.roleChoice) {
        // Coach sign-up is back: return to the coach form the user chose.
        setStep('register');
      } else {
        setRecheckNote('Coach sign-up is still not available.');
      }
    } finally {
      setRecheckLoading(false);
    }
  };

  if (step === 'coach-unavailable') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Coach sign-up is not available right now
            </Text>
          </View>
          <View
            style={styles.noticeBox}
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            testID="coach-choice-withdrawn-notice"
          >
            <Text style={styles.noticeText}>
              You chose to coach clients, but coach sign-up was switched off while you were signing up. No account has been created. You can create a client account instead, or check again later.
            </Text>
          </View>
          {recheckNote ? (
            <Text style={styles.subtitle} testID="coach-choice-recheck-note">{recheckNote}</Text>
          ) : null}
          <TouchableOpacity
            style={styles.registerButton}
            onPress={() => {
              setIntendedRole('client');
              setRecheckNote('');
              setError('');
              setStep('register');
            }}
            accessibilityRole="button"
            accessibilityLabel="Create a client account instead"
            testID="coach-choice-withdrawn-client"
          >
            <Text style={styles.registerButtonText}>Create a client account instead</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, recheckLoading && styles.buttonDisabled]}
            onPress={recheckPolicy}
            disabled={recheckLoading}
            accessibilityRole="button"
            accessibilityLabel="Check again for coach sign-up"
            accessibilityState={{ disabled: recheckLoading, busy: recheckLoading }}
            testID="coach-choice-withdrawn-recheck"
          >
            {recheckLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.secondaryButtonText}>Check again</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
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
          {error ? (
            <View style={styles.errorBox} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
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
          {roleChoiceEnabled === true && !arrivedWithCode ? (
            hasTypedCode ? (
              <Text style={styles.subtitle} testID="invite-code-means-client">
                An invite code always means a client account.
              </Text>
            ) : (
              <Text
                style={styles.changeRole}
                accessibilityRole="button"
                accessibilityLabel="Change how you will use the app"
                testID="role-choice-change"
                onPress={() => setStep('role')}
              >
                {isCoachSignup ? 'Here to train instead?' : 'Coach clients instead?'}
              </Text>
            )
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
  secondaryButton: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  secondaryButtonText: { ...Typography.button, color: colors.primary },
  supportLink: { ...typography.bodySmall, color: colors.primary, textDecorationLine: 'underline', marginTop: Spacing.sm },
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
