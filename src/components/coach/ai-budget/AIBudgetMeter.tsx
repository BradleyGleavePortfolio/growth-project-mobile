/**
 * AIBudgetMeter — Coach Home header chip.
 *
 * Renders a compact "AI Usage: $X / $125" pill with a thin progress bar
 * underneath. Mounted in the Coach Home header area; visibility is gated
 * by `surfaceFor(budget)` (chip surface = 60-79% used).
 *
 * Surfaces above 'chip' (tutorial / banner / paused) DO NOT render the chip —
 * those surfaces use their own dedicated UI (tutorial modal, banner, hard
 * pause modal) that already conveys the same information at a higher
 * salience level.
 *
 * Tap → opens `CreditPackCheckoutScreen` in the SettingsStack. The whole
 * chip is a HapticPressable so a top-up is always 1 tap away.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../HapticPressable';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';
import {
  formatCents,
  clampPctForDisplay,
  type CoachAIBudgetResponse,
} from '../../../api/types/coachAIBudget';

export interface AIBudgetMeterProps {
  budget: CoachAIBudgetResponse;
  onPress?: () => void;
  /** Optional override for the outer container (margin / alignment). */
  style?: ViewStyle;
  testID?: string;
}

export function AIBudgetMeter({
  budget,
  onPress,
  style,
  testID,
}: AIBudgetMeterProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pct = clampPctForDisplay(budget.pct_used);

  return (
    <HapticPressable
      intent="light"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`AI usage ${pct.toFixed(0)} percent of monthly allowance. Tap to buy credits.`}
      accessibilityHint="Opens the credit pack checkout."
      style={[styles.container, style]}
      testID={testID ?? 'ai-budget-meter'}
    >
      <View style={styles.row}>
        <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
        <Text style={styles.label}>
          AI Usage:{' '}
          <Text style={styles.amount} testID="ai-budget-meter-amount">
            {formatCents(budget.used_displayed_cents)} / {formatCents(budget.total_displayed_cents)}
          </Text>
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { width: `${pct}%` }]}
          testID="ai-budget-meter-fill"
        />
      </View>
    </HapticPressable>
  );
}

export default AIBudgetMeter;

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 6,
      minWidth: 180,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    label: {
      fontSize: 12,
      color: colors.textSecondary,
      letterSpacing: 0.3,
    },
    amount: {
      color: colors.textPrimary,
      fontWeight: '600',
    },
    barTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
      overflow: 'hidden',
    },
    barFill: {
      height: '100%',
      backgroundColor: colors.primary,
    },
  });
}
