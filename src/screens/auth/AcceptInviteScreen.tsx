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
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { invitesApi } from '../../api/invites';
import type { AcceptInviteResponse } from '../../types/invites';
import { secureStorage } from '../../services/secureStorage';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';

type LocalState =
  | { kind: 'loading' }
  | { kind: 'accepted'; payload: Extract<AcceptInviteResponse, { accepted: true }>; authed: boolean }
  | { kind: 'failed'; reason: 'expired' | 'already_accepted' | 'invalid' | 'network'; message?: string };

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
    if (!token) {
      setState({ kind: 'failed', reason: 'invalid' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const res = await invitesApi.acceptInvite(token);
      if (!res.accepted) {
        const reason: 'expired' | 'already_accepted' | 'invalid' =
          res.reason === 'expired'
            ? 'expired'
            : res.reason === 'already_accepted'
              ? 'already_accepted'
              : 'invalid';
        setState({ kind: 'failed', reason, message: res.message });
        return;
      }
      const sessionToken = await secureStorage.getItem('supabase_token');
      const authed = Boolean(sessionToken) || res.redirectTo === 'app_open';
      setState({ kind: 'accepted', payload: res, authed });
    } catch (err) {
      setState({
        kind: 'failed',
        reason: 'network',
        message: errorMessage(err, 'Could not reach the server'),
      });
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
      <View style={styles.center} testID="accept-loading">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.helperText}>Accepting your invite…</Text>
      </View>
    );
  }

  if (state.kind === 'failed') {
    return (
      <View style={styles.center} testID={`accept-failed-${state.reason}`}>
        <Ionicons
          name={
            state.reason === 'expired'
              ? 'time-outline'
              : state.reason === 'already_accepted'
                ? 'checkmark-done-outline'
                : 'alert-circle-outline'
          }
          size={48}
          color={colors.textMuted}
        />
        <Text style={styles.title}>{failureTitle(state.reason)}</Text>
        <Text style={styles.body}>
          {state.message ?? failureBody(state.reason)}
        </Text>
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
      </View>
    );
  }

  const { payload, authed } = state;
  return (
    <View style={styles.center} testID="accept-success">
      <Ionicons name="checkmark-circle" size={56} color={colors.success} />
      <Text style={styles.title}>You're in</Text>
      <Text style={styles.body}>
        {payload.coachName
          ? `You've been linked to ${payload.coachName}.`
          : "You've been linked to your coach."}
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
    </View>
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
      return "We couldn't find that invite. Double-check the link from your coach.";
    case 'network':
      return 'Check your connection and try again.';
  }
}

function failureCta(
  reason: 'expired' | 'already_accepted' | 'invalid' | 'network',
): string {
  if (reason === 'already_accepted') return 'Go to sign in';
  return 'Back to welcome';
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
      gap: 12,
    },
    title: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 8,
    },
    body: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    helperText: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 4,
    },
    primaryBtn: {
      marginTop: 12,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 32,
      borderRadius: 8,
      minWidth: 200,
      alignItems: 'center',
    },
    primaryBtnText: {
      color: colors.textOnPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    secondaryBtn: {
      marginTop: 4,
      backgroundColor: colors.surfaceElevated,
      paddingVertical: 12,
      paddingHorizontal: 32,
      borderRadius: 8,
      minWidth: 200,
      alignItems: 'center',
    },
    secondaryBtnText: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
}

// Exported for tests
export const __test = { failureTitle, failureBody, failureCta };
