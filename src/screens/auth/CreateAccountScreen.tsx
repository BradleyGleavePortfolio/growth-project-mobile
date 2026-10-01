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
import {
  SIGNUP_EMAIL_EXISTS_MESSAGE,
  SIGNUP_INVITE_INVALID_MESSAGE,
  SIGNUP_PENDING_MESSAGE,
} from '../../utils/authErrorMessage';
import {
  describeSignInFailure,
  describeSignupFailure,
  reportAuthFailure,
  type AuthFailure,
} from '../../utils/authFailure';
import {
  clearRoleSelectionPending,
  markRoleSelectionPending,
  userIdOf,
} from '../../lib/roleSelectionGate';
import {
  getLastKnownSignupPolicy,
  loadSignupPolicy,
  UNKNOWN_SIGNUP_POLICY,
  type SignupPolicy,
} from '../../lib/signupPolicy';
import { readInviteAttachOutcome } from '../../lib/inviteAttachOutcome';
import PasteInviteCodeButton from '../../components/invite/PasteInviteCodeButton';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';
import AppleSignInButton from '../../components/AppleSignInButton';
import { signInWithApple } from '../../utils/appleAuth';
import { supportMailto } from '../../constants/support';
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
  COACH_SIGNUP_RETRY_EMAIL_EXISTS_MESSAGE,
  classifyCoachSignupFailure,
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
import {
  hasAnyUnconfirmedCoachSignup,
  hasUnconfirmedCoachSignup,
  mayHaveUnconfirmedCoachSignup,
  normaliseEmail,
  rememberUnconfirmedCoachSignup,
  resolveUnconfirmedCoachSignup,
  type CoachSignupIdentity,
  type CoachSignupMethod,
} from '../../lib/coachSignupAttempt';
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

// #306 r5: signup refusals that need their own actions, not a generic line.
//  - 'email_exists': 409 "Email already registered" (Log in, Reset password).
//  - 'email_exists_after_coach': the same 409 after this email's coach
//    attempt ended unconfirmed; the earlier attempt may have created it
//    (Log in, Contact support).
//  - 'signup_pending': 409 `signup_pending` from backend #597 (Reset
//    password, Back). There is no resend endpoint, so no resend button.
type SignupIssue = 'email_exists' | 'email_exists_after_coach' | 'signup_pending';

// #306 r3 (Sol B1-R2 / Opus C1): what the coach-unavailable step may say.
//  - 'not-started': no request was sent; "No account has been created" is true.
//  - 'refused': a request was sent and the server refused it; this attempt
//    created nothing, but nothing is claimed about other accounts.
//  - 'unconfirmed': a request was sent and its outcome is unknown (no answer,
//    timeout, 5xx); the app says neither "created" nor "not created".
type WithdrawalState = 'not-started' | 'refused' | 'unconfirmed';

// Outcome of one signup attempt once it has settled.
type AttemptOutcome = 'not-sent' | 'success' | 'refused' | 'unconfirmed';

interface SignupAttempt {
  method: CoachSignupMethod;
  coach: boolean;
}

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

/**
 * The address the server stored for this signup. Backend #597 stores and
 * returns the canonical (lower-cased) form; signing in on the verify step
 * with that form works whether or not the server's password login is
 * case-insensitive (Sol B-597-1). A response without it, or with an address
 * that is not the submitted one, keeps the submitted spelling.
 */
function canonicalEmailFrom(data: unknown, submitted: string): string {
  const returned = (data as { email?: unknown } | null | undefined)?.email;
  if (typeof returned !== 'string') return submitted;
  const trimmed = returned.trim();
  return trimmed && normaliseEmail(trimmed) === normaliseEmail(submitted) ? trimmed : submitted;
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
  const [withdrawal, setWithdrawal] = useState<WithdrawalState>('not-started');
  const [signupIssue, setSignupIssue] = useState<SignupIssue | null>(null);
  // #306 r5 (owner 13:34): the error box offers Contact support when the
  // failure is unknown (its message carries the reference) or unconfirmed.
  const [errorSupport, setErrorSupport] = useState(false);
  // #306 r6 (Sol B-306-4): a wrong password on the verify step offers Log in.
  const [errorLogIn, setErrorLogIn] = useState(false);
  const showFailure = (failure: AuthFailure) => {
    setError(failure.message);
    setErrorSupport(failure.support);
    setErrorLogIn(false);
  };

  // The policy effect below runs once and resolves later; it reads the
  // current choice and step through refs, not the mount-time closure.
  const isCoachSignupRef = useRef(isCoachSignup);
  isCoachSignupRef.current = isCoachSignup;
  const stepRef = useRef(step);
  stepRef.current = step;
  // #306 r3 (Sol B1-R2 / Opus C1): the signup request in flight, if any. While
  // it is set, a live policy answer is held in `deferredPolicyRef` and applied
  // only after the request settles, with that request's own outcome. So no
  // outcome notice ("No account has been created", a client re-choice) can
  // appear while a coach request may be committing on the server.
  const attemptRef = useRef<SignupAttempt | null>(null);
  const deferredPolicyRef = useRef<SignupPolicy | null>(null);
  // Snapshot of the last submitted attempt: whether it asked for coach. The
  // verify step and routing use this, not the live form state, so a policy
  // answer that lands after submission cannot change what is reported.
  const coachAttemptRef = useRef(false);
  // #306 r4 (Sol B1-R3): an earlier coach attempt from this device (this
  // mount, or before a remount via the persisted marker) whose outcome was
  // never proven. It outlives the in-flight ref: a later policy answer, a
  // cancelled or refused retry, or a re-check proves nothing about it, so the
  // withdrawal step never says "No account has been created" or offers a
  // client account while it is set. Cleared only by a server answer for the
  // same sign-in (lib/coachSignupAttempt).
  const unresolvedCoachRef = useRef(false);

  const markUnconfirmed = async (method: CoachSignupMethod, identity?: CoachSignupIdentity) => {
    unresolvedCoachRef.current = true;
    await rememberUnconfirmedCoachSignup(method, identity);
  };

  // A server answer arrived for this sign-in: its earlier attempt is resolved.
  const resolveAttempt = async (method: CoachSignupMethod, identity?: CoachSignupIdentity) => {
    await resolveUnconfirmedCoachSignup(method, identity);
    unresolvedCoachRef.current = await hasAnyUnconfirmedCoachSignup();
  };

  // Apply a live signup policy. `outcome` is the settled result of the
  // attempt the policy was held for ('not-sent' when nothing was in flight).
  const applyLivePolicy = (policy: SignupPolicy, outcome: AttemptOutcome) => {
    setRequireInviteCode(policy.inviteCodeRequired);
    setGoogleEnabled(policy.googleEnabled);
    if (outcome === 'success') {
      // The request answered; its own result decides what the user sees.
      setRoleChoiceEnabled(policy.roleChoice);
      return;
    }
    // #306 r2 (B2): the cached policy offered the choice, the user chose
    // coach, and the live policy now says role choice is off. Keep the coach
    // intent, say so, and require an explicit choice. Never fall through to a
    // client registration the user did not choose.
    const coachChoiceWithdrawn =
      !policy.roleChoice &&
      isCoachSignupRef.current &&
      stepRef.current !== 'verify' &&
      stepRef.current !== 'policy';
    setRoleChoiceEnabled(policy.roleChoice);
    if (coachChoiceWithdrawn) {
      // #306 r4 (Sol B1-R3): this request's outcome is not the whole story.
      // While an earlier coach attempt is unresolved, nothing proves that no
      // account exists, whatever this request did (nothing sent, cancelled,
      // refused).
      const state: WithdrawalState = unresolvedCoachRef.current
        ? 'unconfirmed'
        : outcome === 'not-sent'
          ? 'not-started'
          : outcome;
      setWithdrawal(state);
      if (state === 'not-started') setError('');
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
  };

  // Start an attempt. Returns false when one is already in flight, so a second
  // submission (from any button) can never race the first.
  const beginAttempt = (attempt: SignupAttempt): boolean => {
    if (attemptRef.current) return false;
    attemptRef.current = attempt;
    coachAttemptRef.current = attempt.coach;
    return true;
  };

  // Settle the attempt and apply any policy answer that arrived meanwhile.
  const settleAttempt = (outcome: AttemptOutcome) => {
    attemptRef.current = null;
    const deferred = deferredPolicyRef.current;
    deferredPolicyRef.current = null;
    if (deferred) applyLivePolicy(deferred, outcome);
  };

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

  // #306 r5 (Sol B-306-1): a refusal (the pre-handler refusal of
  // `intended_role`) proves only that THIS request created nothing. When an
  // earlier coach attempt with the same sign-in is still unresolved, the
  // screen keeps the "outcome unknown" step (Sign in to check, Check again,
  // Contact support): never "No account was created", never a client offer.
  // #306 r7: caution only (any earlier attempt with this method that is not
  // provably someone else's); it never binds or consumes the marker.
  const showCoachRefusal = async (method: CoachSignupMethod, identity?: CoachSignupIdentity) => {
    if (await mayHaveUnconfirmedCoachSignup(method, identity)) {
      unresolvedCoachRef.current = true;
      setError('');
      setErrorSupport(false);
      setWithdrawal('unconfirmed');
      setStep('coach-unavailable');
      return;
    }
    setErrorSupport(false);
    setError(COACH_SIGNUP_UNAVAILABLE_MESSAGE);
  };

  // #306 r6 (Sol B-306-5): the outcome is unknown, so the copy keeps "may
  // or may not have been created", and the failure is reported to Sentry
  // under the backend's reference (or the id this app sent), which the user
  // can quote to support.
  const showUnconfirmed = (err: unknown, method: CoachSignupMethod) => {
    const ref = reportAuthFailure(err, 'sign_up', method, 'unconfirmed');
    setError(`${COACH_SIGNUP_UNCONFIRMED_MESSAGE} If you contact support, quote reference ${ref.short}.`);
    setErrorSupport(true);
    setErrorLogIn(false);
  };

  // Signup policy through the shared reader (audit A1): a live policy wins,
  // then the last policy fetched this session, then UNKNOWN_SIGNUP_POLICY
  // (code optional, Google hidden). A failed GET never blocks a codeless
  // email signup; the backend stays the authority on whether a code is
  // needed.
  useEffect(() => {
    let mounted = true;
    (async () => {
      // The persisted marker is read alongside the policy, so a remount after
      // an unconfirmed coach attempt still knows about it before any policy
      // answer is applied (#306 r4, Sol B1-R3).
      const [{ policy }, unresolved] = await Promise.all([
        loadSignupPolicy(() => authApi.getSignupPolicy()),
        hasAnyUnconfirmedCoachSignup(),
      ]);
      if (!mounted) return;
      if (unresolved) unresolvedCoachRef.current = true;
      if (attemptRef.current) {
        // A signup request is in flight: hold the answer until it settles.
        deferredPolicyRef.current = policy;
        return;
      }
      applyLivePolicy(policy, 'not-sent');
    })();
    return () => {
      mounted = false;
    };
    // Runs once at mount; applyLivePolicy reads the current state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (step === 'coach-unavailable' || attemptRef.current) return;
    // Surrounding spaces (keyboard autocomplete) are never part of the
    // address. Case is left to the server, which stores the canonical form
    // and returns it (#597); see `accountEmail` below.
    const submittedEmail = email.trim();
    if (!name || !submittedEmail || !password) {
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

    if (!beginAttempt({ method: 'email', coach: isCoachSignup })) return;
    let outcome: AttemptOutcome = 'not-sent';
    let accountEmail = submittedEmail;
    setLoading(true);
    setError('');
    setErrorSupport(false);
    setSignupIssue(null);

    try {
      if (trimmedCode) {
        // Audit A2: preflight through the public preview, which resolves both
        // code families (permanent CoachProfile GP- links and InviteCode rows).
        // /auth/validate-invite-code only knows InviteCode rows and rejected
        // the permanent clinic QR code. A preview failure (network) does not
        // block: signup-with-code re-checks the code authoritatively.
        try {
          const res = await authApi.getInvitePreview(trimmedCode);
          if (res.data && res.data.valid === false) {
            setError(SIGNUP_INVITE_INVALID_MESSAGE);
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
            email: submittedEmail,
            password,
            phone: phone || undefined,
            invite_code: trimmedCode,
          });
          // C03: the account can be created while the coach attach fails.
          // Never continue silently; remember it so the post-verify step
          // routes to the enter-code retry screen.
          const outcomeAttach = readInviteAttachOutcome(res?.data);
          setInviteAttachError(outcomeAttach.attached === false ? outcomeAttach.reason ?? 'unknown' : null);
          accountEmail = canonicalEmailFrom(res?.data, submittedEmail);
        } else {
          setInviteAttachError(null);
          const res = await authApi.register(
            {
              name,
              email: submittedEmail,
              password,
              phone: phone || undefined,
            },
            intendedRoleForRequest(roleChoiceEnabled === true, intendedRole, false),
          );
          accountEmail = canonicalEmailFrom(res?.data, submittedEmail);
          // Backend #597 returns the role the account was created with. A
          // coach request the server did not apply is said plainly, never
          // treated as a normal client signup.
          const createdRole = res?.data?.role;
          const notApplied = isCoachSignup && typeof createdRole === 'string' && createdRole !== 'coach';
          setCoachRequestNotApplied(notApplied);
          if (notApplied) await setSignupRoleNotice('coach_request_not_applied');
        }
        outcome = 'success';
        // A server answer for this email: an earlier unconfirmed coach attempt
        // with it did not create an account (the email would have been taken).
        await resolveAttempt('email', submittedEmail);
        // Sign in on the verify step with the address the server stored.
        if (accountEmail !== email) setEmail(accountEmail);

        await AsyncStorage.setItem('pending_email', accountEmail);
        track(AnalyticsEvents.SIGNUP_COMPLETED, {
          method: 'email',
          has_invite_code: !!trimmedCode,
          ...(isCoachSignup ? { intended_role: 'coach' } : {}),
        });
        setStep('verify');
      } catch (err) {
        if (isCoachSignupUnavailable(err)) {
          // The server rejected the body before any handler ran, so this
          // request created nothing. Never fall back to a client account here,
          // and never claim more than this request proves (r5, Sol B-306-1).
          outcome = 'refused';
          await showCoachRefusal('email', submittedEmail);
          return;
        }
        if (isCoachSignup) {
          outcome = classifyCoachSignupFailure(err);
          if (outcome === 'unconfirmed') {
            // #306 r3: no server answer. The account may exist; say neither.
            await markUnconfirmed('email', submittedEmail);
            showUnconfirmed(err, 'email');
            return;
          }
        } else {
          outcome = 'refused';
        }
        // #306 r5: status and backend code decide the copy (owner 13:28).
        const failure = describeSignupFailure(err, 'email');
        if (failure.kind === 'signup_pending') {
          // #597: an unconfirmed sign-up for this address exists and this
          // request did not prove it owns it. No local account exists, so
          // this is never the "already exists" copy (Opus C-306-3 i).
          setSignupIssue('signup_pending');
          return;
        }
        if (failure.kind === 'email_exists') {
          // #306 r3 (Opus C4), r4: after this email's unconfirmed coach
          // attempt, the account may be the one that attempt created.
          setSignupIssue(
            (await hasUnconfirmedCoachSignup('email', submittedEmail)) ? 'email_exists_after_coach' : 'email_exists',
          );
          return;
        }
        showFailure(failure);
      }
    } finally {
      setLoading(false);
      settleAttempt(outcome);
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
      method: CoachSignupMethod;
      providerEmail?: string;
      /** #306 r6 (Sol C-306-5): stable Apple / Google id of this sign-in. */
      providerSubject?: string;
      /** The signup carried an invite / QR code (always a client). */
      hasInviteCode?: boolean;
    },
  ): Promise<'success' | 'unconfirmed'> => {
    // The submitted attempt decides, not the live form: a policy answer that
    // landed after submission must not change what is reported (#306 r3).
    const coachAttempt = coachAttemptRef.current;
    // #306 r2 (B1): a coach request is reported only from a server-returned
    // role. A missing role proves nothing, so the user is told the outcome is
    // unconfirmed and the provisional session is dropped; never "created as
    // a client account".
    const identityEmail =
      opts.method === 'email' ? email : typeof (user as { email?: unknown } | null | undefined)?.email === 'string'
        ? ((user as { email: string }).email)
        : undefined;
    const identity: CoachSignupIdentity =
      opts.method === 'email' ? identityEmail : { email: identityEmail, subject: opts.providerSubject };
    if (coachAttempt && typeof user?.role !== 'string') {
      await dropUnconfirmedSession();
      await markUnconfirmed(
        opts.method,
        opts.method === 'email' ? identityEmail : { email: identityEmail ?? opts.providerEmail, subject: opts.providerSubject },
      );
      // A success response with no role: no server error to quote, so the
      // reference is this app's own (reported under the same id).
      showUnconfirmed(new Error('coach_role_missing'), opts.method);
      return 'unconfirmed';
    }
    // #306 r3 (Opus C4), r4: an earlier coach attempt with this sign-in ended
    // unconfirmed. If this answer is "existing account, not a coach", that
    // account may be the one the lost attempt created, so "already had an
    // account" would be untrue. This holds for a client retry too (for
    // example after a remount where coach sign-up is now off).
    const serverAnswered = typeof user?.role === 'string';
    // #306 r5 (Opus C-306-1): an invite / QR signup is a client joining a
    // coach. It never shows a notice about an earlier coach attempt (a
    // provider marker without an email matches any sign-in with that
    // provider, possibly someone else's) and never consumes that marker.
    const consultMarker = serverAnswered && !opts.hasInviteCode;
    const retryOfUnconfirmed = consultMarker && (await hasUnconfirmedCoachSignup(opts.method, identity));
    if (isServerCoach(user)) {
      await resolveAttempt(opts.method, identity);
      await setUserCache(user as Parameters<typeof setUserCache>[0]);
      await purgePersistedQueryCacheForAllUsers();
      await clearRoleSelectionPending();
      await clearSignupRoleNotice();
      authEvents.emit();
      return 'success';
    }
    // #306 r5 (Sol B-306-2): the gate records whose it is.
    await markRoleSelectionPending(userIdOf(user as { id?: unknown } | null | undefined));
    let signupNotice: SignupRoleNoticeKind | undefined;
    if (coachAttempt) {
      signupNotice =
        opts.isNewUser === false
          ? retryOfUnconfirmed
            ? 'coach_retry_not_applied'
            : 'existing_account'
          : 'coach_request_not_applied';
    } else if (retryOfUnconfirmed && opts.isNewUser === false) {
      signupNotice = 'coach_retry_not_applied';
    }
    // Persist the notice before the marker is resolved, so a crash in
    // between repeats the notice instead of losing it.
    // #306 r5 (Opus C-306-2): no notice for this signup clears a stored one,
    // so a notice left on the device is never shown to a later signup.
    if (signupNotice) await setSignupRoleNotice(signupNotice);
    else await clearSignupRoleNotice();
    if (consultMarker) await resolveAttempt(opts.method, identity);
    const params = { ...(opts.retryParams ?? {}), ...(signupNotice ? { signupNotice } : {}) };
    if (Object.keys(params).length > 0) navigation.replace('RoleSelection', params);
    else navigation.replace('RoleSelection');
    return 'success';
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
        method: 'email',
        hasInviteCode: !!inviteCode.trim(),
        retryParams:
          inviteAttachError !== null
            ? { inviteAttachError, inviteCode: inviteCode.trim() || undefined }
            : undefined,
      });
    } catch (err) {
      // #306 r6 (Sol B-306-4): the shared mapper decides from the status,
      // the machine code and the message, never from a bare "email" in the
      // text ("Invalid email or password" is a wrong password).
      const failure = describeSignInFailure(err, { flow: 'verify' });
      showFailure(failure);
      setErrorLogIn(failure.kind === 'invalid_credentials');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleAppleSignup = async () => {
    if (step === 'coach-unavailable' || attemptRef.current) return;
    // A coach signup never carries a client invite code.
    const trimmedCode = isCoachSignup ? '' : inviteCode.trim();
    if (requireInviteCode && !isCoachSignup && !trimmedCode) {
      setError('Enter your coach invite code before continuing with Apple.');
      return;
    }
    if (!beginAttempt({ method: 'apple', coach: isCoachSignup })) return;
    const coachAttempt = isCoachSignup;
    let outcome: AttemptOutcome = 'not-sent';
    setLoading(true);
    setError('');
    setErrorSupport(false);
    setSignupIssue(null);
    try {
      // The role question was answered before this round-trip; the backend
      // fixes the role when it inserts the User row, so this is the only
      // moment `intended_role` can matter.
      const result = await signInWithApple({
        inviteCode: trimmedCode || undefined,
        intendedRole: intendedRoleForRequest(roleChoiceEnabled === true, intendedRole, !!trimmedCode),
      });
      if (!result.success) {
        // A cancelled Apple sheet never reached the server.
        if (result.cancelled) return;
        if (result.error_code === COACH_SIGNUP_UNAVAILABLE) {
          outcome = 'refused';
          await showCoachRefusal('apple', { email: result.provider_email, subject: result.provider_subject });
          return;
        }
        if (result.error_code === COACH_SIGNUP_UNCONFIRMED) {
          outcome = 'unconfirmed';
          // #306 r5 (Opus C-306-3 ii): nothing on the device may claim an
          // account the server did not confirm, even if a token was stored.
          await dropUnconfirmedSession();
          await markUnconfirmed('apple', { email: result.provider_email, subject: result.provider_subject });
          showUnconfirmed(result.error_detail ?? result.error, 'apple');
          return;
        }
        outcome = 'refused';
        const failure = describeSignupFailure(result.error_detail ?? result.error, 'apple');
        if (!failure.cancelled) {
          showFailure(failure);
          Alert.alert('Sign in with Apple', failure.message);
        }
        return;
      }
      outcome = await routeAfterAuth(result.user, {
        method: 'apple',
        isNewUser: result.is_new_user,
        providerSubject: result.provider_subject,
        hasInviteCode: !!trimmedCode,
        retryParams:
          trimmedCode && result.invite_attached === false
            ? { inviteAttachError: result.invite_attach_error ?? 'not_attached', inviteCode: trimmedCode }
            : undefined,
      });
    } catch (err) {
      if (isCoachSignupUnavailable(err)) {
        outcome = 'refused';
        await showCoachRefusal('apple');
        return;
      }
      if (coachAttempt) {
        // Thrown after the request may have left: the outcome is unknown.
        outcome = 'unconfirmed';
        await dropUnconfirmedSession();
        await markUnconfirmed('apple');
        showUnconfirmed(err, 'apple');
        return;
      }
      outcome = 'refused';
      const failure = describeSignupFailure(err, 'apple');
      if (!failure.cancelled) showFailure(failure);
    } finally {
      setLoading(false);
      settleAttempt(outcome);
    }
  };

  const handleGoogleSignup = async () => {
    if (step === 'coach-unavailable' || attemptRef.current) return;
    // A coach signup never carries a client invite code.
    const trimmedCode = isCoachSignup ? '' : inviteCode.trim();
    if (requireInviteCode && !isCoachSignup && !trimmedCode) {
      setError('Enter your coach invite code before continuing with Google.');
      return;
    }
    if (!beginAttempt({ method: 'google', coach: isCoachSignup })) return;
    const coachAttempt = isCoachSignup;
    let outcome: AttemptOutcome = 'not-sent';
    setLoading(true);
    setError('');
    setErrorSupport(false);
    setSignupIssue(null);
    try {
      const result = await signInWithGoogle({
        inviteCode: trimmedCode || undefined,
        intendedRole: intendedRoleForRequest(roleChoiceEnabled === true, intendedRole, !!trimmedCode),
      });

      if (!result.success) {
        if (result.error_code === COACH_SIGNUP_UNAVAILABLE) {
          outcome = 'refused';
          await showCoachRefusal('google', { email: result.provider_email, subject: result.provider_subject });
          return;
        }
        if (result.error_code === COACH_SIGNUP_UNCONFIRMED) {
          outcome = 'unconfirmed';
          await markUnconfirmed('google', { email: result.provider_email, subject: result.provider_subject });
          showUnconfirmed(result.error_detail ?? result.error, 'google');
          return;
        }
        const failure = describeSignupFailure(result.error_detail ?? result.error, 'google');
        // A cancelled Google sheet never reached the server.
        outcome = failure.cancelled ? 'not-sent' : 'refused';
        if (!failure.cancelled) {
          showFailure(failure);
          Alert.alert('Sign in with Google', failure.message);
        }
        return;
      }

      // A typed code the backend did not attach is carried to the retry
      // step with the code prefilled instead of being dropped.
      // #306 r5 (Sol B-306-3): the server's own `invite_attached:false` (for
      // example an already-paired student scanning another coach's code)
      // routes to the retry step, which offers "Keep my current coach".
      outcome = await routeAfterAuth(result.user, {
        method: 'google',
        isNewUser: result.is_new_user,
        providerSubject: result.provider_subject,
        hasInviteCode: !!trimmedCode,
        retryParams:
          trimmedCode && result.invite_attached === false
            ? {
                inviteAttachError: result.invite_attach_error ?? 'not_attached',
                inviteCode: result.invite_code ?? trimmedCode,
              }
            : undefined,
      });
    } catch (err) {
      if (isCoachSignupUnavailable(err)) {
        outcome = 'refused';
        await showCoachRefusal('google');
        return;
      }
      if (coachAttempt) {
        outcome = 'unconfirmed';
        await dropUnconfirmedSession();
        await markUnconfirmed('google');
        showUnconfirmed(err, 'google');
        return;
      }
      outcome = 'refused';
      const failure = describeSignupFailure(err, 'google');
      if (!failure.cancelled) showFailure(failure);
    } finally {
      setLoading(false);
      settleAttempt(outcome);
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
            <View style={styles.errorBox} accessible accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
              {errorLogIn ? (
                <Text
                  style={styles.supportLink}
                  accessibilityRole="link"
                  accessibilityLabel="Log in"
                  testID="verify-error-log-in"
                  onPress={() => navigation.navigate('Login', email.trim() ? { email: email.trim() } : undefined)}
                >
                  Log in
                </Text>
              ) : null}
              {errorSupport ? (
                <Text
                  style={styles.supportLink}
                  accessibilityRole="link"
                  accessibilityLabel="Contact support"
                  testID="signup-error-support"
                  onPress={() => navigation.navigate('SupportInbox')}
                >
                  Contact support
                </Text>
              ) : null}
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
        setError('');
        setWithdrawal('not-started');
        setStep('register');
      } else {
        setRecheckNote('Coach sign-up is still not available.');
      }
    } finally {
      setRecheckLoading(false);
    }
  };

  if (step === 'coach-unavailable') {
    // #306 r3: the copy depends on what the user's own request proved. Only
    // when nothing was sent is "No account has been created" said, and only
    // then is a client account offered straight away. After an unconfirmed
    // request the user is sent to sign in with the same details first, so
    // the earlier attempt is resolved before any new account is made.
    const unconfirmed = withdrawal === 'unconfirmed';
    const withdrawnCopy =
      withdrawal === 'not-started'
        ? 'You chose to coach clients, but coach sign-up was switched off while you were signing up. No account has been created. You can create a client account instead, or check again later.'
        : withdrawal === 'refused'
          ? 'You chose to coach clients, but coach sign-up was switched off while your request was being sent, and your coach sign-up was not completed. You can create a client account instead, or check again later.'
          : 'You chose to coach clients, but coach sign-up has been switched off, and we could not confirm what happened to your coach sign-up request. An account may or may not have been created. Sign in with the same email, Apple ID or Google account first; if the account exists, you will be signed in to it. You can also check again later or contact support.';
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
            <Text style={styles.noticeText} testID={`coach-choice-withdrawn-${withdrawal}`}>
              {withdrawnCopy}
            </Text>
          </View>
          {withdrawal === 'refused' && error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {recheckNote ? (
            <Text style={styles.subtitle} testID="coach-choice-recheck-note">{recheckNote}</Text>
          ) : null}
          {unconfirmed ? (
            <TouchableOpacity
              style={styles.registerButton}
              onPress={() => navigation.navigate('Login', email ? { email } : undefined)}
              accessibilityRole="button"
              accessibilityLabel="Sign in to check"
              testID="coach-choice-withdrawn-sign-in"
            >
              <Text style={styles.registerButtonText}>Sign in to check</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.registerButton}
              onPress={() => {
                setIntendedRole('client');
                setRecheckNote('');
                setError('');
                setWithdrawal('not-started');
                setStep('register');
              }}
              accessibilityRole="button"
              accessibilityLabel="Create a client account instead"
              testID="coach-choice-withdrawn-client"
            >
              <Text style={styles.registerButtonText}>Create a client account instead</Text>
            </TouchableOpacity>
          )}
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
          {unconfirmed ? (
            <Text
              style={styles.supportLink}
              accessibilityRole="link"
              accessibilityLabel="Contact support"
              testID="coach-choice-withdrawn-support"
              onPress={() => navigation.navigate('SupportInbox')}
            >
              Contact support
            </Text>
          ) : null}
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
            {isCoachSignup ? 'Create your coach account' : 'Create your account'}
          </Text>
          <Text style={styles.subtitle}>
            {isCoachSignup
              ? 'Set up your account, then your coaching practice. No code is needed.'
              : requireInviteCode
                ? 'Enter the invite code your coach shared to begin.'
                : 'Have a code from your coach? Add it below, or add it later.'}
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
                onPress={() => {
                  // Never change the role while a signup request is in flight.
                  if (attemptRef.current) return;
                  setStep('role');
                }}
                disabled={loading}
              >
                {isCoachSignup ? 'Here to train instead?' : 'Coach clients instead?'}
              </Text>
            )
          ) : null}
        </View>

        {signupIssue ? (
          <View
            style={styles.noticeBox}
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            testID={`signup-issue-${signupIssue}`}
          >
            <Text style={styles.noticeText}>
              {signupIssue === 'signup_pending'
                ? SIGNUP_PENDING_MESSAGE
                : signupIssue === 'email_exists_after_coach'
                  ? COACH_SIGNUP_RETRY_EMAIL_EXISTS_MESSAGE
                  : SIGNUP_EMAIL_EXISTS_MESSAGE}
            </Text>
            {signupIssue !== 'signup_pending' ? (
              <TouchableOpacity
                style={styles.registerButton}
                onPress={() => navigation.navigate('Login', email.trim() ? { email: email.trim() } : undefined)}
                accessibilityRole="button"
                accessibilityLabel="Log in"
                testID="signup-issue-log-in"
              >
                <Text style={styles.registerButtonText}>Log in</Text>
              </TouchableOpacity>
            ) : null}
            {signupIssue !== 'email_exists_after_coach' ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => navigation.navigate('ForgotPassword')}
                accessibilityRole="button"
                accessibilityLabel="Reset password"
                testID="signup-issue-reset-password"
              >
                <Text style={styles.secondaryButtonText}>Reset password</Text>
              </TouchableOpacity>
            ) : (
              <Text
                style={styles.supportLink}
                accessibilityRole="link"
                accessibilityLabel="Contact support"
                testID="signup-issue-support"
                onPress={() => navigation.navigate('SupportInbox')}
              >
                Contact support
              </Text>
            )}
            {signupIssue === 'signup_pending' ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setSignupIssue(null)}
                accessibilityRole="button"
                accessibilityLabel="Back"
                testID="signup-issue-back"
              >
                <Text style={styles.secondaryButtonText}>Back</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>{error}</Text>
            {errorSupport ? (
              <Text
                style={styles.supportLink}
                accessibilityRole="link"
                accessibilityLabel="Contact support"
                testID="signup-error-support"
                onPress={() => navigation.navigate('SupportInbox')}
              >
                Contact support
              </Text>
            ) : null}
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
                    Linking.openURL(supportMailto('Request access to The Growth Project'))
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
