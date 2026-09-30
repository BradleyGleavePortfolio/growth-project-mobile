/**
 * NeutralAccessState — what an inactive client sees on iOS when client
 * purchase surfaces are hidden (`clientPurchasesHidden()`; App Review 3.1
 * risk removal for the clinic launch).
 *
 * No prices, no plans, no checkout, no "buy" language. It tells the client
 * to ask their coach for an invite code and lets them enter it right here.
 * A successful attach calls `onAttached` (the caller re-checks the server
 * entitlement; clinic codes grant comp access server-side, C01).
 *
 * Errors are mapped to calm copy; raw server strings are never shown.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { authApi } from '../services/api';
import { useTheme } from '../theme/useTheme';
import { NEUTRAL_ACCESS_BODY, NEUTRAL_ACCESS_TITLE } from '../config/purchaseSurfaces';

interface Props {
  onAttached?: () => void | Promise<unknown>;
  testID?: string;
}

export const NEUTRAL_ATTACH_ERROR =
  'That code did not work. Check it with your coach and try again.';
export const NEUTRAL_ATTACH_NETWORK_ERROR =
  'We could not reach the server. Check your connection and try again.';

export default function NeutralAccessState({ onAttached, testID }: Props) {
  const { colors, tokens } = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Enter the invite code from your coach.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authApi.attachInviteCode(trimmed);
      setDone(true);
      await onAttached?.();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? 0;
      setError(status >= 400 && status < 500 ? NEUTRAL_ATTACH_ERROR : NEUTRAL_ATTACH_NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.center, { backgroundColor: colors.background }]} testID={testID ?? 'neutral-access-state'}>
      <Text style={[styles.title, { color: colors.textPrimary, ...tokens.typography.h2 }]} accessibilityRole="header">
        {NEUTRAL_ACCESS_TITLE}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary, ...tokens.typography.body }]}>
        {NEUTRAL_ACCESS_BODY}
      </Text>
      <TextInput
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setError(null);
        }}
        placeholder="Invite code"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        accessibilityLabel="Invite code"
        testID="neutral-access-code-input"
        style={[styles.input, { borderColor: colors.border, color: colors.textPrimary, backgroundColor: colors.surface }]}
      />
      {error ? (
        <Text style={[styles.error, { color: colors.error }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {done && !error ? (
        <Text style={[styles.error, { color: colors.textSecondary }]}>Code accepted. Unlocking…</Text>
      ) : null}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }, busy && styles.disabled]}
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Use invite code"
        testID="neutral-access-submit"
      >
        {busy ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={[styles.buttonText, { color: colors.textOnPrimary, ...tokens.typography.bodyMd }]}>
            Use invite code
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title: { marginBottom: 12, textAlign: 'center' },
  body: { textAlign: 'center', marginBottom: 24 },
  input: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 8,
  },
  error: { alignSelf: 'stretch', fontSize: 13, marginBottom: 8 },
  button: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 8, marginTop: 8, minWidth: 200, alignItems: 'center' },
  buttonText: { fontWeight: '600' },
  disabled: { opacity: 0.6 },
});
