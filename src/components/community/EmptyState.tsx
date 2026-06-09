/**
 * CommunityEmptyState — friendly empty state with Roman voice + a PRIMARY
 * ACTION (UX HARD gate: no spinner-only empty states, no "Coming soon").
 *
 * Every Community empty surface renders: a Roman monogram accent, a stem of
 * Roman copy (Phase 1 in-app scope only), and exactly one primary call to
 * action ("Be the first to post" / "Join your first cohort" / "Send your coach
 * a message"). Touch target is >= 48dp (accessible).
 *
 * Standardized on semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import RomanAvatar from './RomanAvatar';
import {
  romanCopy,
  type RomanCommunityStem,
} from './romanVoice';

export interface CommunityEmptyStateProps {
  /** Roman voice stem to render as the body copy. */
  stem: RomanCommunityStem;
  /** Calling client's first name for the Roman copy interpolation. */
  firstName?: string | null;
  /** Short title above the Roman copy (e.g. "The Hall is quiet"). */
  title: string;
  /** Primary action label — REQUIRED (no spinner-only / placeholder states). */
  actionLabel: string;
  /** Primary action handler — REQUIRED. */
  onAction: () => void;
  /** Optional seed override for the deterministic dry-quip selector. */
  quipSeed?: string;
  testID?: string;
}

export default function CommunityEmptyState({
  stem,
  firstName,
  title,
  actionLabel,
  onAction,
  quipSeed,
  testID,
}: CommunityEmptyStateProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const body = romanCopy(stem, { firstName, seed: quipSeed });

  return (
    <View style={styles.container} testID={testID}>
      <RomanAvatar crop="monogram" size={48} testID="community-empty-roman" />
      <Text style={[styles.title, { color: semanticColors.textPrimary }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: semanticColors.textMuted }]}>
        {body}
      </Text>
      <HapticPressable
        intent="medium"
        onPress={onAction}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        testID={`${testID ?? 'community-empty'}-action`}
        style={[styles.cta, { backgroundColor: semanticColors.accent }]}
      >
        <Text style={[styles.ctaLabel, { color: semanticColors.textOnAccent }]}>
          {actionLabel}
        </Text>
      </HapticPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  cta: {
    marginTop: spacing.lg,
    minHeight: 48, // accessible touch target (>= 48dp Android / >= 44pt iOS)
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
