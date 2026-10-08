/**
 * ResendVerificationLink — "Send a new link" for a sign-up confirmation email
 * that was lost, filtered to spam or expired (FW-ONB-128 B1).
 *
 * Calls the public POST /auth/resend-verification (live in production). The
 * backend answers the same way whether or not the address exists, is already
 * confirmed or the mail provider refused, so the sent copy only says a link
 * is on its way IF an account is waiting; it never claims delivery.
 *
 * States: idle -> sending -> sent (60 s pause before another request) |
 * limited (429) | offline | invalid (400) | failed (anything else, with
 * Contact support when the screen offers it). When no address is known
 * (EmailVerified opened from an expired link) an email field is shown.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { authApi } from '../../services/api';
import { useTheme } from '../../theme/ThemeProvider';
import { lightTokens, type SemanticTokens } from '../../theme/tokens';
import { toAuthErrorDetail } from '../../utils/authErrorDetail';
import { isNetworkFailure } from '../../utils/authFailure';

export const RESEND_COOLDOWN_MS = 60_000;

export const RESEND_COPY = {
  action: 'Send a new link',
  again: 'Send another link',
  sending: 'Sending',
  sent: 'If an account is waiting for confirmation, a new link is on its way. Check the spam folder too.',
  limited: 'Too many new links were requested. Try again later.',
  offline: 'No connection. Check the connection and try again.',
  invalid: 'Check the email address and try again.',
  missingEmail: 'Enter the email address used at sign-up.',
  failed: 'A new link could not be requested. Try again, or contact support.',
} as const;

type Status = 'idle' | 'sending' | 'sent' | 'limited' | 'offline' | 'invalid' | 'missing' | 'failed';

type Props = {
  /** Address to send to; when empty an email field is shown. */
  email?: string;
  /** Contact support route, shown with the failure and limit messages. */
  onContactSupport?: () => void;
  testID?: string;
};

export default function ResendVerificationLink({ email, onContactSupport, testID = 'resend-verification' }: Props) {
  const { semanticColors: colors = lightTokens } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const knownEmail = (email ?? '').trim();
  const [typedEmail, setTypedEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [coolingDown, setCoolingDown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const send = async () => {
    const address = knownEmail || typedEmail.trim();
    if (!address) {
      setStatus('missing');
      return;
    }
    setStatus('sending');
    try {
      await authApi.resendVerification(address);
      setStatus('sent');
      setCoolingDown(true);
      timer.current = setTimeout(() => setCoolingDown(false), RESEND_COOLDOWN_MS);
    } catch (err) {
      const httpStatus = toAuthErrorDetail(err).status;
      if (httpStatus === 429) setStatus('limited');
      else if (httpStatus === 400) setStatus('invalid');
      else if (isNetworkFailure(err)) setStatus('offline');
      else setStatus('failed');
    }
  };

  const message: string | null =
    status === 'sent' ? RESEND_COPY.sent
      : status === 'limited' ? RESEND_COPY.limited
        : status === 'offline' ? RESEND_COPY.offline
          : status === 'invalid' ? RESEND_COPY.invalid
            : status === 'missing' ? RESEND_COPY.missingEmail
              : status === 'failed' ? RESEND_COPY.failed
                : null;
  const showSupport = onContactSupport && (status === 'failed' || status === 'limited');
  const sending = status === 'sending';
  const label = status === 'sent' ? RESEND_COPY.again : RESEND_COPY.action;

  return (
    <View style={styles.wrap} testID={testID}>
      {knownEmail ? null : (
        <TextInput
          style={styles.input}
          value={typedEmail}
          onChangeText={setTypedEmail}
          placeholder="you@email.com"
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Email for a new link"
          testID={`${testID}-email`}
        />
      )}
      {message ? (
        <Text style={styles.message} accessibilityLiveRegion="polite" testID={`${testID}-message`}>
          {message}
        </Text>
      ) : null}
      {showSupport ? (
        <Text
          style={styles.link}
          accessibilityRole="link"
          accessibilityLabel="Contact support"
          testID={`${testID}-support`}
          onPress={onContactSupport}
        >
          Contact support
        </Text>
      ) : null}
      {coolingDown ? null : (
        <TouchableOpacity
          style={styles.button}
          onPress={send}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: sending, busy: sending }}
          testID={`${testID}-button`}
        >
          {sending ? (
            <ActivityIndicator color={colors.accentText} accessibilityLabel={RESEND_COPY.sending} />
          ) : (
            <Text style={styles.link}>{label}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', gap: 8, marginTop: 16, alignSelf: 'stretch' },
    input: {
      alignSelf: 'stretch',
      minHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      color: colors.textPrimary,
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      paddingVertical: 10,
    },
    message: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: colors.textMuted,
      textAlign: 'center',
    },
    button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
    link: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.accentText, textAlign: 'center' },
  });
