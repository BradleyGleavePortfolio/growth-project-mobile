import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { authApi, InvitePreview } from '../../services/api';
import { authEvents } from '../../utils/authEvents';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { readUserCache, setUserCache } from '../../lib/userCache';
import { purgePersistedQueryCacheForAllUsers } from '../../services/queryClient';
import { getLastKnownSignupPolicy, loadSignupPolicy, UNKNOWN_SIGNUP_POLICY } from '../../lib/signupPolicy';
import { inviteAttachErrorMessage } from '../../lib/inviteAttachOutcome';
import {
  clearSignupRoleNotice,
  readSignupRoleNotice,
  signupRoleNoticeMessage,
  signupRoleNoticeNeedsSupport,
  type SignupRoleNoticeKind,
} from '../../lib/signupRoleNotice';
import PasteInviteCodeButton from '../../components/invite/PasteInviteCodeButton';
import InviteCoachCardDetails from '../../components/invite/InviteCoachCardDetails';
import { clearRoleSelectionPending } from '../../lib/roleSelectionGate';
import { isNetworkFailure, unknownAuthFailure } from '../../utils/authFailure';
import { radius, typography } from '../../theme/tokens';
import { useCoachSharingNotice } from '../../lib/coachSharingNotice';
import CoachSharingNotice from '../../components/coachSharing/CoachSharingNotice';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'RoleSelection'>;
  route?: RouteProp<AuthStackParamList, 'RoleSelection'>;
};

// RoleSelection: the last signup step, reached after a session exists.
//
// Who sees it:
//   - Clients (chose "I'm here to train", or arrived with an invite / QR code
//     and are therefore always clients). They pair with a coach here: enter
//     or paste a code, or continue without one when the live signup policy
//     is codeless. This screen only ever selects the client ('student') role.
//   - Retry: signup reported `invite_attached:false`, so the code is mandatory
//     and the banner explains why (see inviteAttachError below).
//   - A person whose signup role request did not end the way they chose
//     (C13): they chose "I coach clients" but the server created a client
//     account; or the Apple ID / Google account already existed so the
//     choice did not apply; or Sign in with Apple / Google on the Login
//     screen found no account and created a client one. The fact is shown
//     here as a plain notice (`signupNotice` param, with the persisted copy
//     from lib/signupRoleNotice as the fallback so a remount cannot lose it)
//     and they continue as a client. We never self-promote to coach from
//     the app.
//
// Who does NOT see it: a user whose server-returned `user.role` is 'coach'
// (the backend honoured `intended_role: 'coach'`). CreateAccount finishes
// auth directly and RootNavigator mounts CoachNavigator.
//
// Authorization: the role always comes from the server. `selectRole('coach')`
// stays rejected by the backend (audit C3), and this screen never calls it.

// Security (audit): never log an Axios error object; it can carry request
// config / Authorization. Status and error class only.
function logRedacted(label: string, err: unknown): void {
  if (!__DEV__) return;
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  const kind = err instanceof Error ? err.name : typeof err;
  console.warn(label, { status: status ?? null, kind });
}

export default function RoleSelectionScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Retry mode: signup created the account but the backend reported
  // `invite_attached:false`. The code field is mandatory here so the client
  // cannot slide past without a coach; there is an explicit, labelled
  // "continue without a coach" only when the live policy allows codeless.
  const attachRetryReason = route?.params?.inviteAttachError;
  const isAttachRetry = typeof attachRetryReason === 'string';
  const [signupNotice, setSignupNotice] = useState<SignupRoleNoticeKind | null>(
    route?.params?.signupNotice ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [requireInviteCode, setRequireInviteCode] = useState(
    () => (getLastKnownSignupPolicy() ?? UNKNOWN_SIGNUP_POLICY).inviteCodeRequired,
  );
  const [inviteCode, setInviteCode] = useState(route?.params?.inviteCode ?? '');
  // B-SHARE-127: with a code, Continue is the join; the sentence shows above it
  // (and its version is sent) only when the server records it.
  const sharingVersion = useCoachSharingNotice();
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  // #306 r5 (owner 13:34): Contact support next to an unknown failure.
  const [errorSupport, setErrorSupport] = useState(false);
  const [cachedCoachId, setCachedCoachId] = useState<string | null>(null);
  // The user already has a coach, so the only thing left is the notice.
  const [acknowledgeOnly, setAcknowledgeOnly] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Shared reader (audit A1): reuses the policy CreateAccount already
      // fetched when this GET fails, and never invents a code requirement.
      const { policy } = await loadSignupPolicy(() => authApi.getSignupPolicy());
      if (!mounted) return;
      setRequireInviteCode(policy.inviteCodeRequired);

      // C13: a notice written by CreateAccount / Login survives a remount of
      // the auth stack; the route param is only the fast path.
      let noticeNow: SignupRoleNoticeKind | null = route?.params?.signupNotice ?? null;
      if (!noticeNow) {
        const stored = await readSignupRoleNotice();
        if (mounted && stored) setSignupNotice(stored);
        noticeNow = stored;
      }

      // B4: never in retry mode. A failed attach to coach B must not be
      // silently skipped because the user is already linked to coach A; the
      // retry screen offers an explicit "Keep my current coach" instead.
      try {
        const u0 = await readUserCache();
        if (mounted) setCachedCoachId(typeof u0?.coach_id === 'string' ? u0.coach_id : null);
      } catch {
        // ignore
      }
      // If the user already has a coach attached (e.g. they signed up with
      // an invite code, or it was attached during Google sign-in), skip role
      // selection entirely — the backend already knows their coach and the
      // form would just re-collect a code we no longer need.
      try {
        const u = await readUserCache();
      if (u) {
          if (mounted && u?.coach_id && !isAttachRetry) {
            // #306 r4 (Sol B2-R3 / C1): a user who already has a coach skips
            // this step, but never past an unread signup notice; it is shown
            // and acknowledged first.
            if (noticeNow) {
              setAcknowledgeOnly(true);
              return;
            }
            await clearRoleSelectionPending();
            await clearSignupRoleNotice();
            authEvents.emit();
            return;
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const previewCode = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setInvitePreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
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

  // Merge the server-confirmed role / coach into the cached user.
  const persistRole = async (role: string | undefined, coachId: string | null | undefined) => {
    const user = await readUserCache();
    if (!user) return;
    if (role) user.role = role as typeof user.role;
    if (coachId) user.coach_id = coachId;
    await setUserCache(user);
    // P1-1 (PR #192): purge any orphan persisted cache blobs written under a
    // stale boot-time key before the first persistence pass for this user.
    await purgePersistedQueryCacheForAllUsers();
  };

  // Re-audit R3: a server-confirmed attachment is remembered here, in
  // session state that does not depend on the local cache write. Once set,
  // Continue retries only persistence + role completion and never calls
  // attachInviteCode again (a second call would consume another use of a
  // bounded code or be rejected for an exhausted single-use code).
  const attachedRef = useRef<{ role: string; coachId: string | null } | null>(null);
  const [attached, setAttached] = useState<{ role: string; coachId: string | null } | null>(null);
  const inFlightRef = useRef(false);

  const finishAfterAttach = async (confirmed: { role: string; coachId: string | null }) => {
    await persistRole(confirmed.role, confirmed.coachId);
    // Finalize role selection WITHOUT a code (no second redemption). The
    // attach already set the role on the server, so a failure here is not
    // fatal and is not retried as a redemption.
    try {
      const fin = await authApi.selectRole('student', undefined);
      if (typeof fin?.data?.role === 'string') await persistRole(fin.data.role, fin.data.coach_id);
    } catch (finErr) {
      logRedacted('selectRole finalize after attach failed', finErr);
    }
    await clearRoleSelectionPending();
    await clearSignupRoleNotice();
    authEvents.emit();
  };

  const handleKeepCurrentCoach = async () => {
    await clearRoleSelectionPending();
    await clearSignupRoleNotice();
    authEvents.emit();
  };

  const handleContinue = async (opts: { skipCode?: boolean } = {}) => {
    if (inFlightRef.current) return;
    setError('');
    setErrorSupport(false);

    // R3: already connected on the server; only finish locally.
    const confirmed = attachedRef.current;
    if (confirmed) {
      inFlightRef.current = true;
      setLoading(true);
      try {
        await finishAfterAttach(confirmed);
      } catch (err) {
        logRedacted('finish sign-up after attach failed', err);
        const msg = 'You are connected to your coach. Sign-up did not finish saving on this device. Tap Finish sign-up to try again.';
        setError(msg);
        Alert.alert('Connected, finishing sign-up', msg);
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
      return;
    }

    const trimmed = opts.skipCode ? '' : inviteCode.trim();

    if ((requireInviteCode || (isAttachRetry && !opts.skipCode)) && !trimmed) {
      setError('Enter the invite code your coach shared.');
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    // Audit A2: exactly ONE redemption. `attachInviteCode` resolves both
    // code families (permanent CoachProfile GP- links and InviteCode rows),
    // consumes one use, and sets {role:'student', coach_id} on the server.
    // It is never followed by selectRole(code). Any attach failure, 4xx or
    // transient, is shown to the user; nothing falls through to a second
    // redemption.
    let stage: 'attach' | 'finish' = 'attach';
    try {
      if (trimmed) {
        const res = await authApi.attachInviteCode(trimmed, sharingVersion);
        const data = (res?.data ?? {}) as { role?: string; coach_id?: string | null };
        const confirmedNow = {
          role: typeof data.role === 'string' ? data.role : 'student',
          coachId: typeof data.coach_id === 'string' ? data.coach_id : null,
        };
        attachedRef.current = confirmedNow;
        setAttached(confirmedNow);
        stage = 'finish';
        await finishAfterAttach(confirmedNow);
      } else {
        const res = await authApi.selectRole('student', undefined);
        await persistRole(res.data.role, res.data.coach_id);
        await clearRoleSelectionPending();
        await clearSignupRoleNotice();
        authEvents.emit();
      }
    } catch (err) {
      if (stage === 'finish') {
        logRedacted('finish sign-up after attach failed', err);
        const msg = 'You are connected to your coach. Sign-up did not finish saving on this device. Tap Finish sign-up to try again.';
        setError(msg);
        Alert.alert('Connected, finishing sign-up', msg);
        return;
      }
      const r = err as {
        response?: { status?: number; data?: { reason?: string; code?: string; message?: string } };
      };
      const status = r?.response?.status ?? 0;
      // A 4xx on the attach/select call is an invite problem (bad, expired,
      // used-up code, coach unavailable): show friendly copy, never the raw
      // server string.
      // #306 r5 (owner 13:34): never the raw server string, never a bare
      // "try again". A connection problem says so; anything else unknown
      // carries a reference and Contact support (utils/authFailure).
      let unknownFailure = false;
      let msg: string;
      if (trimmed && status >= 400 && status < 500) {
        msg = inviteAttachErrorMessage(
          r.response?.data?.reason ?? r.response?.data?.code ?? r.response?.data?.message ?? 'invalid',
        );
      } else if (isNetworkFailure(err)) {
        msg = 'The server could not be reached. Check your connection, then tap Continue again.';
      } else {
        msg = unknownAuthFailure(err, 'role_selection').message;
        unknownFailure = true;
      }
      setError(msg);
      setErrorSupport(unknownFailure);
      if (isAttachRetry) Alert.alert('Coach not connected yet', msg);
      else Alert.alert('Sign-up unavailable', msg);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const noticeBox = signupNotice ? (
    <View style={styles.retryBox} accessible accessibilityRole="alert" testID="signup-role-notice">
      <Text style={styles.retryText}>{signupRoleNoticeMessage(signupNotice)}</Text>
      {signupRoleNoticeNeedsSupport(signupNotice) ? (
        <Text
          style={styles.supportLink}
          accessibilityRole="link"
          accessibilityLabel="Contact support"
          testID="signup-role-notice-support"
          onPress={() => navigation?.navigate('SupportInbox')}
        >
          Contact support
        </Text>
      ) : null}
    </View>
  ) : null;

  if (acknowledgeOnly && signupNotice) {
    return (
      <ScrollView style={styles.page} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <StatusBar barStyle="dark-content" />
        <View style={styles.header}>
          <Text style={styles.title}>Before you continue</Text>
          {noticeBox}
        </View>
        <View style={styles.cardsContainer}>
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={handleKeepCurrentCoach}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            testID="signup-role-notice-acknowledge"
          >
            <Text style={styles.continueText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.greeting}>One more step.</Text>
        <Text style={styles.title}>Pair with your coach</Text>
        {noticeBox}
        {isAttachRetry ? (
          <View
            style={styles.retryBox}
            accessible
            accessibilityRole="alert"
            testID="invite-attach-retry-banner"
          >
            <Text style={styles.retryText}>{inviteAttachErrorMessage(attachRetryReason)}</Text>
          </View>
        ) : null}
        <Text style={styles.subtitle}>
          {isAttachRetry
            ? 'Enter your invite code to connect to your coach.'
            : requireInviteCode
            ? 'Enter the invite code your coach shared. This connects you to their roster.'
            : 'If your coach shared an invite code, enter it now. Otherwise continue.'}
        </Text>
      </View>

      <View style={styles.cardsContainer}>
        <View style={styles.inputBlock}>
          <Text style={styles.label}>INVITE CODE</Text>
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
            testID="role-invite-code-input"
            editable={!attached}
          />
          <PasteInviteCodeButton
            disabled={loading || !!attached}
            testID="role-paste-invite-code"
            onCode={(code) => {
              setError('');
              setInviteCode(code);
              setInvitePreview(null);
              void previewCode(code);
            }}
            onNoCode={(message) => setError(message)}
          />
          {attached ? (
            <Text style={styles.invitePreviewOk} testID="role-attached-note">
              Connected, finishing sign-up.
            </Text>
          ) : previewLoading ? (
            <Text style={styles.invitePreviewMuted}>Checking code…</Text>
          ) : invitePreview?.valid ? (
            <>
              <Text style={styles.invitePreviewOk}>
                You will be paired with{' '}
                <Text style={styles.coachName}>{invitePreview.coach_name || invitePreview.business_name || 'your coach'}</Text>.
              </Text>
              <InviteCoachCardDetails
                headline={invitePreview.headline}
                specialties={invitePreview.specialties}
                testID="role-coach-card"
              />
            </>
          ) : invitePreview && !invitePreview.valid ? (
            <Text style={styles.invitePreviewBad}>
              {invitePreview.reason || 'This code is not currently active.'}
            </Text>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {error && errorSupport ? (
            <Text
              style={styles.supportLink}
              accessibilityRole="link"
              accessibilityLabel="Contact support"
              testID="role-error-support"
              onPress={() => navigation?.navigate('SupportInbox')}
            >
              Contact support
            </Text>
          ) : null}
        </View>

        <CoachSharingNotice
          version={!attached && inviteCode.trim() ? sharingVersion : null}
          coachName={invitePreview?.valid ? invitePreview.business_name || invitePreview.coach_name : null}
        />
        <TouchableOpacity
          style={[styles.continueBtn, loading && styles.btnDisabled]}
          onPress={() => handleContinue()}
          disabled={loading}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={attached ? 'Finish sign-up' : isAttachRetry ? 'Connect to my coach' : 'Continue'}
          testID="role-continue"
        >
          {loading ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.continueText}>
              {attached ? 'Finish sign-up' : isAttachRetry ? 'Connect to my coach' : 'Continue'}
            </Text>
          )}
        </TouchableOpacity>

        {isAttachRetry && cachedCoachId && !attached ? (
          <TouchableOpacity
            onPress={handleKeepCurrentCoach}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Keep my current coach"
            testID="role-keep-current-coach"
          >
            <Text style={styles.skipText}>Keep my current coach</Text>
          </TouchableOpacity>
        ) : null}

        {isAttachRetry && !requireInviteCode && !cachedCoachId && !attached ? (
          <TouchableOpacity
            onPress={() => handleContinue({ skipCode: true })}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Continue without a coach for now"
            testID="role-skip-coach"
          >
            <Text style={styles.skipText}>Continue without a coach for now</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.coachNote}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={styles.coachNoteText}>
            Coach access is managed by the platform team. If you should be a coach, contact your administrator.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 40,
  },
  greeting: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: 16,
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
    color: colors.textSecondary,
  },
  cardsContainer: {
    gap: 16,
  },
  inputBlock: {
    gap: 6,
  },
  label: {
    ...typography.eyebrow,
    color: colors.textSecondary,
    letterSpacing: 1,
  },
  input: {
    ...typography.body,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    minHeight: 52,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  coachName: { ...typography.h2, color: colors.textPrimary },
  invitePreviewOk: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 12 },
  invitePreviewBad: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 12 },
  invitePreviewMuted: { ...typography.bodySmall, color: colors.textMuted, marginTop: 12 },
  errorText: { ...typography.bodySmall, color: colors.textPrimary, marginTop: 12 },
  retryBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingVertical: 16,
    marginVertical: 12,
  },
  retryText: { ...typography.bodySmall, color: colors.textPrimary },
  supportLink: { ...typography.bodySmall, color: colors.primary, textDecorationLine: 'underline', marginTop: 8, minHeight: 44, paddingVertical: 11 },
  skipText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', minHeight: 44, paddingVertical: 11 },
  continueBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: 16,
    minHeight: 52,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  continueText: {
    ...typography.bodyMd,
    color: colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  coachNote: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    marginTop: 8,
  },
  coachNoteText: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.textMuted,
  },

  });
