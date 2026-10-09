/**
 * EmailVerifiedScreen — landing for the sign-up confirmation link.
 *
 * HUNT-01-124 (B-HUNT01-1): the backend asks Supabase to send new members
 * back to `tgp://verified` after they tap Confirm in the email. The app had
 * no route for that URL, so the tap opened the app on whatever screen was
 * last shown (Welcome after a cold start) with no word that the email was
 * confirmed and no next step.
 *
 * Supabase confirms the address before it redirects, so this screen only
 * tells the member what happened and where to go next:
 *   - sign-up screen still open underneath (same phone, app in the
 *     background): Continue returns to it, where "I verified my email"
 *     signs in with the password already typed;
 *   - otherwise: Sign in opens Login.
 * An expired or already-used link (Supabase `error_code=otp_expired`) gets
 * its own copy, Send a new link (FW-ONB-128 B1) and a support route. The linking config strips the session
 * tokens from the URL, so this screen never sees or stores them.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { radius, typography } from '../../theme/tokens';
import ResendVerificationLink from './ResendVerificationLink';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'EmailVerified'>;
  route: RouteProp<AuthStackParamList, 'EmailVerified'>;
};

function signupScreenIsUnderneath(navigation: Props['navigation']): boolean {
  const state = navigation.getState?.();
  if (!state || typeof state.index !== 'number') return false;
  return state.routes[state.index - 1]?.name === 'CreateAccount';
}

export default function EmailVerifiedScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const linkProblem = route.params?.status === 'link_problem';
  const backToSignup = !linkProblem && signupScreenIsUnderneath(navigation);

  const title = linkProblem ? 'This link has expired or was already used' : 'Email confirmed';
  const body = linkProblem
    ? 'If the email address is already confirmed, sign in to continue. If not, enter it below for a new link.'
    : backToSignup
      ? 'Continue to the sign-up screen and tap I verified my email to finish.'
      : 'Sign in with the email address and password used at sign-up to continue.';

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <View style={styles.content} accessible accessibilityRole="summary">
        <Ionicons
          name={linkProblem ? 'alert-circle-outline' : 'checkmark-circle-outline'}
          size={32}
          color={colors.primary}
        />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
      </View>

      {backToSignup ? (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.replace('Login')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          <Text style={styles.primaryButtonText}>Sign in</Text>
        </TouchableOpacity>
      )}

      {linkProblem ? <ResendVerificationLink testID="link-problem-resend" /> : null}

      {linkProblem ? (
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('SupportInbox')}
          accessibilityRole="button"
          accessibilityLabel="Contact support"
        >
          <Text style={styles.secondaryButtonText}>Contact support</Text>
        </TouchableOpacity>
      ) : null}
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
      justifyContent: 'center',
      paddingVertical: 64,
    },
    content: {
      alignItems: 'center',
      gap: 16,
      marginBottom: 40,
    },
    // The theme's title role (32/40): the old 35 sat under Cormorant's 1.211 em
    // line box and could clip descenders on Android (B-SMALLFIX-135).
    title: {
      ...typography.h1,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    body: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      lineHeight: 24,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 8,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: radius.button,
      minHeight: 52,
      alignItems: 'center',
    },
    primaryButtonText: {
      ...typography.bodyMd,
      color: colors.textOnPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    secondaryButton: {
      marginTop: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      minHeight: 44,
      alignItems: 'center',
      paddingVertical: 12,
    },
    secondaryButtonText: {
      ...typography.bodyMd,
      color: colors.primary,
      fontSize: 16,
      fontWeight: '600',
    },
  });
