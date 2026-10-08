/**
 * LoadFailedNotice: the calm "could not load" block for coach screens
 * (QA-COACH-HOME-131). One plain sentence that names what did not load and a
 * forest "Try again" text button with a 44 pt target. No red, no icon, no
 * fill, so the screen's own primary action stays the only forest fill.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, typography } from '../../theme/tokens';

interface Props {
  /** One sentence naming what did not load, e.g. "Roster numbers could not load." */
  message: string;
  /** Re-runs the failed read. */
  onRetry: () => void;
  /** Root testID; the button is `${testID}-retry`. */
  testID: string;
}

export default function LoadFailedNotice({ message, onRetry, testID }: Props) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={[styles.message, { color: sc.textPrimary }]}>{message}</Text>
      <HapticPressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        testID={`${testID}-retry`}
        style={styles.retry}
      >
        <Text style={[styles.retryLabel, { color: sc.accentText }]}>Try again</Text>
      </HapticPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  message: {
    ...typography.body,
    textAlign: 'center',
  },
  retry: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  retryLabel: {
    ...typography.bodyMd,
  },
});
