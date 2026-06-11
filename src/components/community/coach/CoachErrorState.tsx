/**
 * CoachErrorState — the honest load-failure surface for every v1-6 coach
 * community screen (UX P0.2 fix).
 *
 * The original lane collapsed load errors into the calm/celebratory empty
 * state, so a coach could falsely believe their inbox / cohort / queue was
 * empty when the request had actually failed. This component is the distinct
 * error branch: it renders Roman's NEUTRAL face (never the celebratory smile),
 * an honest "could not load" line in Roman's voice register (no
 * "Oops/Whoops"), a small danger chip that visually separates it from the calm
 * empty state, and a retry button.
 *
 * It is intentionally visually distinct from `CoachEmptyState`:
 *   - a `semantic.danger` chip above the copy (calm empty states have none),
 *   - never the `smile` crop (only `neutral`),
 *   - a primary "Try again" action (empty states have no action).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RomanAvatar from '../RomanAvatar';
import HapticPressable from '../../HapticPressable';
import { useTheme } from '../../../theme/useTheme';
import { spacing, radius, semantic } from '../../../theme/tokens';

export interface CoachErrorStateProps {
  /** Honest, neutral failure line. One sentence, no "Oops/Whoops/Uh oh". */
  message: string;
  /** Re-run the failed query. */
  onRetry: () => void;
  /** Disables the retry button while a refetch is already in flight. */
  retrying?: boolean;
  /** Root testID — the avatar nested inside uses `${testID}-avatar`. */
  testID?: string;
}

export default function CoachErrorState({
  message,
  onRetry,
  retrying = false,
  testID,
}: CoachErrorStateProps): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar
        crop="neutral"
        size={64}
        testID={testID ? `${testID}-avatar` : 'error-roman-avatar'}
      />
      <View
        style={[
          styles.chip,
          { backgroundColor: semantic.danger.bg, borderColor: semantic.danger.border },
        ]}
        accessibilityElementsHidden
      >
        <Text style={[styles.chipText, { color: semantic.danger.fg }]}>
          Could not load
        </Text>
      </View>
      <Text style={[styles.copy, { color: semanticColors.textPrimary }]}>
        {message}
      </Text>
      <HapticPressable
        intent="medium"
        onPress={onRetry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        accessibilityState={{ disabled: retrying }}
        testID={testID ? `${testID}-retry` : 'coach-error-retry'}
        style={[
          styles.retry,
          {
            backgroundColor: retrying
              ? semanticColors.disabledBg
              : semanticColors.accent,
          },
        ]}
      >
        <Text
          style={[
            styles.retryLabel,
            {
              color: retrying
                ? semanticColors.textOnDisabled
                : semanticColors.textOnAccent,
            },
          ]}
        >
          Try again
        </Text>
      </HapticPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  copy: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 320,
  },
  retry: {
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  retryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
