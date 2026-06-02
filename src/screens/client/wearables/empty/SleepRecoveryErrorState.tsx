/**
 * SleepRecoveryErrorState — shown when the samples query fails. Per Bradley LAW
 * (#36 silent failures, #50 graceful degradation): a clear, actionable retry +
 * a "last synced" line when cached data exists. NEVER a swallowed error, NEVER
 * a placeholder/not-yet-built message, NEVER a bare spinner.
 *
 * Copy stays calm and reassuring (UX gate §5.6) — we tell the user their data
 * is safe and offer a single obvious action.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { RECOVERY_PALETTE } from '../recoveryTheme';

export interface SleepRecoveryErrorStateProps {
  colors: ThemeColors;
  onRetry: () => void;
  /** Relative time of the last cached sync, e.g. "2 hours ago". Optional. */
  lastSyncedLabel?: string | null;
  testID?: string;
}

export function SleepRecoveryErrorState({
  colors,
  onRetry,
  lastSyncedLabel,
  testID,
}: SleepRecoveryErrorStateProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const message = lastSyncedLabel
    ? `Showing your last synced data from ${lastSyncedLabel}.`
    : "We couldn't reach the health server just now. Your data is safe — let's try again.";

  return (
    <View style={styles.wrap} testID={testID ?? 'sleep-recovery-error'}>
      <Ionicons name="cloud-offline-outline" size={36} color={RECOVERY_PALETTE.accentMuted} />
      <Text style={styles.message} testID="sleep-recovery-error-message">
        {message}
      </Text>
      <TouchableOpacity
        style={styles.cta}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        testID="sleep-recovery-error-retry"
      >
        <Text style={styles.ctaText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48, gap: 14 },
    message: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
    cta: {
      backgroundColor: RECOVERY_PALETTE.accent,
      paddingVertical: 12,
      paddingHorizontal: 28,
      borderRadius: 12,
    },
    ctaText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15, letterSpacing: 0.3 },
  });
}

export default SleepRecoveryErrorState;
