/**
 * EmptyState — Generic composable empty-state component.
 *
 * Displays an SVG icon, headline, optional body text, and an optional CTA
 * button. All colour values come from theme tokens (no hardcoded hex). Use
 * the pre-composed variants (EmptyStateNoClients, EmptyStateNoWorkouts, …)
 * for specific contexts, or compose directly for one-off use.
 *
 * @module src/ui/empty-states/EmptyState
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { spacingTokens as spacing, typographyTokens as typography, radiusTokens as radius } from '../../theme';

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** SVG icon element to render above the headline. Must be a React element
   *  (e.g. from react-native-svg or an inline SVG component). */
  icon: React.ReactElement;
  /** Short primary message — displayed as h2/serif. */
  headline: string;
  /** Optional supporting copy — displayed below the headline. */
  body?: string;
  /** Label for the optional call-to-action button. */
  ctaLabel?: string;
  /** Handler for the CTA button. Required when ctaLabel is set. */
  onCta?: () => void;
  /** Optional override for the outer container style. */
  style?: ViewStyle;
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * Generic Empty State shell. Compose with an SVG icon and copy; the
 * pre-composed variants below are the preferred way to consume this.
 */
export function EmptyState({
  icon,
  headline,
  body,
  ctaLabel,
  onCta,
  style,
}: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View
      style={[styles.container, style]}
      accessibilityRole="none"
      testID="empty-state-container"
    >
      <View style={styles.iconWrapper} accessibilityElementsHidden>
        {icon}
      </View>

      <Text
        style={styles.headline}
        accessibilityRole="header"
        testID="empty-state-headline"
      >
        {headline}
      </Text>

      {body ? (
        <Text
          style={styles.body}
          testID="empty-state-body"
        >
          {body}
        </Text>
      ) : null}

      {ctaLabel && onCta ? (
        <TouchableOpacity
          style={styles.cta}
          onPress={onCta}
          activeOpacity={0.8}
          accessibilityLabel={ctaLabel}
          accessibilityRole="button"
          testID="empty-state-cta"
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingVertical: spacing['3xl'],
      paddingHorizontal: spacing['2xl'],
      gap: spacing.lg,
    },
    iconWrapper: {
      marginBottom: spacing.sm,
      opacity: 0.7,
    },
    headline: {
      ...typography.h2,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    body: {
      ...typography.bodySmall,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: spacing['2xl'],
      lineHeight: 22,
    },
    cta: {
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: radius.sm,
    },
    ctaText: {
      ...typography.caption,
      color: colors.textOnPrimary,
    },
  });

export default EmptyState;
