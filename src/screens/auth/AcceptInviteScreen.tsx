/**
 * AcceptInviteScreen — Email Pipeline v1.
 *
 * PUBLIC entry point — mounted in the AuthNavigator and reachable via:
 *   tgp://invite/accept/:token
 *   https://app.trygrowthproject.com/invite/accept/:token
 *
 * Flow:
 *   1. POST /invites/accept/:token (no auth header) on mount.
 *   2. Render one of three success paths based on session state +
 *      backend redirect hint:
 *        - signed in → "You're linked to coach X" + Continue
 *        - not signed in, account exists → Login (email prefilled)
 *        - not signed in, new account → CreateAccount (email + token)
 *   3. Render failure UI for `expired` / `already_accepted` / `invalid`.
 *
 * Backend may not return `redirectTo`; the screen falls back to inspecting
 * SecureStore for a session token. CreateAccount accepts an optional
 * `invite_code` param and uses the same attach-on-signup flow as the
 * existing `tgp://join/<code>` deep link.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { invitesApi } from '../../api/invites';
import type { AcceptInviteResponse } from '../../types/invites';
import { secureStorage } from '../../services/secureStorage';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { isValidInviteToken } from '../../utils/inviteToken';
import { typography } from '../../theme/tokens';

type FailureReason = 'expired' | 'already_accepted' | 'invalid' | 'network';

type LocalState =
  | { kind: 'loading' }
  | { kind: 'accepted'; payload: Extract<AcceptInviteResponse, { accepted: true }>; authed: boolean }
  | { kind: 'failed'; reason: FailureReason };

/**
 * Map a (possibly server-supplied) status string to a closed failure
 * reason. Unknown strings collapse to `'invalid'` so we never render a
 * raw backend code to the user.
 */
function mapBackendReason(input: unknown): FailureReason {
  if (typeof input !== 'string') return 'invalid';
  const norm = input.trim().toUpperCase();
  if (norm === 'EXPIRED' || norm === 'INVITE_EXPIRED') return 'expired';
  if (norm === 'ALREADY_ACCEPTED' || norm === 'INVITE_ALREADY_ACCEPTED')
    return 'already_accepted';
  if (
    norm === 'INVALID' ||
    norm === 'INVITE_INVALID' ||
    norm === 'INVITE_NOT_FOUND' ||
    norm === 'NOT_FOUND'
  )
    return 'invalid';
  return 'invalid';
}

type AuthParamList = {
  AcceptInvite: { token: string };
  Welcome: undefined;
  Login: { email?: string } | undefined;
  CreateAccount: { invite_code?: string; email?: string } | undefined;
};

export default function AcceptInviteScreen({
  route,
  navigation,
}: {
  route: RouteProp<AuthParamList, 'AcceptInvite'>;
  navigation: NavigationProp<AuthParamList>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const token = route.params?.token;
  const [state, setState] = useState<LocalState>({ kind: 'loading' });

  const accept = useCallback(async () => {
    // Fail closed on malformed/missing tokens — no network call.
    if (!token || !isValidInviteToken(token)) {
      setState({ kind: 'failed', reason: 'invalid' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const res = await invitesApi.acceptInvite(token);
      if (!res.accepted) {
        setState({ kind: 'failed', reason: mapBackendReason(res.reason) });
        return;
      }
      const sessionToken = await secureStorage.getItem('supabase_token');
      const authed = Boolean(sessionToken) || res.redirectTo === 'app_open';
      setState({ kind: 'accepted', payload: res, authed });
    } catch (err) {
      // Never render raw exception strings to the user — log details for
      // operators and surface a fixed-copy network failure to the UI.
      console.error('AcceptInviteScreen: accept failed', errorMessage(err));
      setState({ kind: 'failed', reason: 'network' });
    }
  }, [token]);

  useEffect(() => {
    void accept();
  }, [accept]);

  const onContinue = useCallback(() => {
    if (state.kind !== 'accepted') return;
    if (state.authed) {
      // Signed in — bounce to the root nav. RootNavigator detects the
      // auth state and renders the matching tabs; we just dismiss this
      // screen so the user lands on whatever role-based home is mounted.
      navigation.navigate('Welcome');
      return;
    }
    navigation.navigate('Login', { email: state.payload.email });
  }, [state, navigation]);

  const onCreateAccount = useCallback(() => {
    if (state.kind !== 'accepted') return;
    navigation.navigate('CreateAccount', {
      invite_code: token,
      email: state.payload.email,
    });
  }, [state, navigation, token]);

  const onBackToWelcome = useCallback(() => {
    navigation.navigate('Welcome');
  }, [navigation]);

  if (state.kind === 'loading') {
    return (
      <ScrollView contentContainerStyle={styles.center} style={styles.page} testID="accept-loading">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.helperText}>Checking your invite…</Text>
      </ScrollView>
    );
  }

  if (state.kind === 'failed') {
    return (
      <ScrollView contentContainerStyle={styles.center} style={styles.page} testID={`accept-failed-${state.reason}`}>
        <Ionicons
          name={
            state.reason === 'expired'
              ? 'time-outline'
              : state.reason === 'already_accepted'
                ? 'checkmark-done-outline'
                : 'alert-circle-outline'
          }
          size={32}
          color={colors.textMuted}
        />
        <Text style={styles.title}>{failureTitle(state.reason)}</Text>
        <Text style={styles.body}>{failureBody(state.reason)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={failureCta(state.reason)}
          onPress={
            state.reason === 'already_accepted' ? onBackToWelcome : onBackToWelcome
          }
          style={styles.primaryBtn}
          testID="accept-failed-cta"
        >
          <Text style={styles.primaryBtnText}>
            {failureCta(state.reason)}
          </Text>
        </Pressable>
        {state.reason === 'network' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={accept}
            style={styles.secondaryBtn}
            testID="accept-retry"
          >
            <Text style={styles.secondaryBtnText}>Try again</Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }

  const { payload, authed } = state;
  return (
    <ScrollView contentContainerStyle={styles.center} style={styles.page} testID="accept-success">
      <Ionicons name="checkmark-circle-outline" size={32} color={colors.primary} />
      <Text style={styles.overline}>Coach invite</Text>
      <Text style={styles.title}>Invite ready</Text>
      {payload.coachName ? <Text style={styles.coachName}>{payload.coachName}</Text> : null}
      <Text style={styles.body}>
        This invite is ready to use.
      </Text>
      {authed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue to app"
          onPress={onContinue}
          style={styles.primaryBtn}
          testID="accept-success-continue"
        >
          <Text style={styles.primaryBtnText}>Continue to app</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.helperText}>
            Sign in or create an account to finish setup.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            onPress={onContinue}
            style={styles.primaryBtn}
            testID="accept-success-login"
          >
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create account"
            onPress={onCreateAccount}
            style={styles.secondaryBtn}
            testID="accept-success-signup"
          >
            <Text style={styles.secondaryBtnText}>Create account</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function failureTitle(
  reason: 'expired' | 'already_accepted' | 'invalid' | 'network',
): string {
  switch (reason) {
    case 'expired':
      return 'Invite expired';
    case 'already_accepted':
      return 'Already accepted';
    case 'invalid':
      return 'Invalid invite';
    case 'network':
      return "Can't reach server";
  }
}

function failureBody(
  reason: 'expired' | 'already_accepted' | 'invalid' | 'network',
): string {
  switch (reason) {
    case 'expired':
      return 'Ask your coach to send you a new invite link.';
    case 'already_accepted':
      return 'This invite has already been used. Sign in to continue.';
    case 'invalid':
      return 'This invite link is not valid. Please contact your coach.';
    case 'network':
      return 'Check your connection and try again.';
  }
}

function failureCta(
  _reason: 'expired' | 'already_accepted' | 'invalid' | 'network',
): string {
  return 'Back to welcome';
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    overline: { ...typography.eyebrow, color: colors.textMuted, marginTop: 16 },
    coachName: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
    center: {
      flexGrow: 1,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 64,
      gap: 12,
    },
    title: {
      ...typography.h1,
      textAlign: 'center',
      color: colors.textPrimary,
      marginTop: 8,
    },
    body: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    helperText: {
      ...typography.bodySmall,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 4,
    },
    primaryBtn: {
      marginTop: 12,
      backgroundColor: colors.primary,
      paddingVertical: 16,
      paddingHorizontal: 32,
      borderRadius: 4,
      minHeight: 52,
      width: '100%',
      alignItems: 'center',
    },
    primaryBtnText: {
      ...typography.bodyMd,
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    secondaryBtn: {
      marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      paddingVertical: 12,
      paddingHorizontal: 32,
      minHeight: 44,
      width: '100%',
      alignItems: 'center',
    },
    secondaryBtnText: {
      ...typography.bodyMd,
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
}

// Exported for tests
export const __test = { failureTitle, failureBody, failureCta };
