import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { formatDunningAmount, formatDunningDate, type ClientDunningStatus } from './dunningApi';
import type { DunningErrorCopy } from './dunningErrorCopy';
import { useDunning } from './DunningLockoutProvider';

/** Banner copy for Days 0-9. Never invents an amount or a date. */
export function bannerCopy(status: ClientDunningStatus): { title: string; body: string } {
  const amount = formatDunningAmount(status.amount_cents, status.currency);
  const failedOn = formatDunningDate(status.failed_at);
  const lockOn = formatDunningDate(status.lockout_at);
  const charge = amount ? `We could not charge ${amount}` : 'Your last payment did not go through';
  const when = amount && failedOn ? ` on ${failedOn}` : '';
  const keep = lockOn
    ? `Update your card by ${lockOn} to keep access to your plan.`
    : 'Update your card to keep access to your plan.';
  return { title: 'Your payment did not go through', body: `${charge}${when}. ${keep}` };
}

/**
 * Inline (in-screen, not floating) past-due notice for Days 0-9 of a failed
 * payment (S-DUNNING). Renders nothing unless the backend reports an active,
 * unlocked v2 cycle, so it is invisible while FEATURE_DUNNING_V2 is off.
 */
export function DunningBanner({ surface }: { surface: string }) {
  const dunning = useDunning();
  const { semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DunningErrorCopy | null>(null);

  const onUpdate = useCallback(async () => {
    if (!dunning) return;
    setBusy(true);
    setError(null);
    setError(await dunning.updateCard(surface));
    setBusy(false);
  }, [dunning, surface]);

  const status = dunning?.status;
  if (!dunning || !status || !status.enabled || status.state !== 'past_due') return null;
  const copy = bannerCopy(status);

  return (
    <View style={styles.wrap} testID="dunning-banner" accessibilityRole="alert">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primary, busy && styles.disabled]}
          onPress={onUpdate}
          disabled={busy}
          accessibilityRole="button"
          testID="dunning-banner-update-card"
        >
          {busy ? (
            <ActivityIndicator color={semanticColors.textOnAccent} />
          ) : (
            <Text style={styles.primaryText}>Update card</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          onPress={dunning.messageCoach}
          accessibilityRole="button"
          testID="dunning-banner-message-coach"
        >
          <Text style={styles.secondaryText}>Message coach</Text>
        </TouchableOpacity>
      </View>
      {error ? (
        <Text style={styles.error} testID="dunning-banner-error">
          {error.message}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: SemanticTokens) =>
  StyleSheet.create({
    wrap: {
      borderWidth: 1,
      borderColor: c.accent,
      backgroundColor: c.bgSurface,
      padding: 14,
      borderRadius: 4,
      marginBottom: 16,
    },
    title: { fontSize: 15, fontWeight: '600', color: c.textPrimary, marginBottom: 4 },
    body: { fontSize: 13, lineHeight: 19, color: c.textPrimary },
    actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    primary: { backgroundColor: c.accent, paddingHorizontal: 14, paddingVertical: 9, minWidth: 110, alignItems: 'center' },
    disabled: { opacity: 0.6 },
    primaryText: { color: c.textOnAccent, fontSize: 13, fontWeight: '600' },
    secondary: { borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 9 },
    secondaryText: { color: c.textPrimary, fontSize: 13, fontWeight: '500' },
    error: { fontSize: 12, lineHeight: 17, color: c.accentText, marginTop: 10 },
  });
