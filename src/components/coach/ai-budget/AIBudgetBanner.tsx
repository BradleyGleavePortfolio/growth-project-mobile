/**
 * AIBudgetBanner — 95-99% threshold surface.
 *
 * Persistent banner pinned to the top of Coach Home. Renders ONLY when the
 * budget surface is 'banner' (computed by `surfaceFor`). Tapping the CTA
 * opens `CreditPackCheckoutScreen`.
 *
 * Mirrors the tone of the existing `StripeSetupBanner` / `OfflineBanner`
 * surfaces so coaches recognize the visual grammar.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../HapticPressable';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';
import {
  formatCents,
  type CoachAIBudgetResponse,
} from '../../../api/types/coachAIBudget';

export interface AIBudgetBannerProps {
  budget: CoachAIBudgetResponse;
  onBuyCredits: () => void;
  testID?: string;
}

export function AIBudgetBanner({
  budget,
  onBuyCredits,
  testID,
}: AIBudgetBannerProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const remaining = formatCents(budget.remaining_displayed_cents);

  return (
    <View style={styles.container} testID={testID ?? 'ai-budget-banner'}>
      <Ionicons
        name="warning-outline"
        size={18}
        color={colors.noticeWarningText}
        style={styles.icon}
      />
      <View style={styles.textCol}>
        <Text style={styles.title}>Last 5% of AI allowance remaining</Text>
        <Text style={styles.subtitle}>
          {remaining} left until period ends on{' '}
          {formatPeriodEnd(budget.period_end)}
        </Text>
      </View>
      <HapticPressable
        intent="medium"
        onPress={onBuyCredits}
        accessibilityRole="button"
        accessibilityLabel="Buy AI credits"
        style={styles.cta}
        testID="ai-budget-banner-cta"
      >
        <Text style={styles.ctaText}>Buy credits</Text>
      </HapticPressable>
    </View>
  );
}

export default AIBudgetBanner;

function formatPeriodEnd(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.noticeWarningBg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    icon: { marginTop: 2 },
    textCol: { flex: 1 },
    title: {
      color: colors.noticeWarningText,
      fontWeight: '600',
      fontSize: 14,
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    cta: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    ctaText: {
      color: colors.textOnPrimary,
      fontWeight: '600',
      fontSize: 13,
      letterSpacing: 0.4,
    },
  });
}
