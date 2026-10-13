/**
 * PK-2 (owner 2026-10-12): the coach's AI pool on the Money page, always
 * shown, as a bar and in numbers (the Coach Home meter's "AI Usage" line,
 * from the same budget query and formatCents). Right under it, "Buy more
 * credits" opens the credit packs (CreditPackCheckout; PK-1 Option 1: the
 * coach picks the pack there). Where packs are not sold the caller passes
 * no onBuy, so the pool shows alone with no button and no buy wording.
 * Loading and a failed read use the shared QuietLoading / QuietError.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { UseAIBudgetResult } from "../../../hooks/useAIBudget";
import { clampPctForDisplay, formatCents } from "../../../api/types/coachAIBudget";
import { PrimaryButton } from "../../../ui";
import { loadFailureMessage, QuietError, QuietLoading } from "../../../ui/states/QuietStates";
import { HapticService } from "../../../ui/haptics/haptics.service";
import { useTheme, type ThemeColors } from "../../../theme/ThemeProvider";
import { radius, typography } from "../../../theme/tokens";

interface Props {
  query: Pick<UseAIBudgetResult, "data" | "error" | "isFetching" | "refetch">;
  onBuy?: () => void;
}

export default function MoneyAIPool({ query, onBuy }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const budget = query.data;
  const pct = budget ? clampPctForDisplay(budget.pct_used) : 0;
  const amount = budget
    ? `${formatCents(budget.used_displayed_cents)} / ${formatCents(budget.total_displayed_cents)}`
    : "";
  return (
    <View style={styles.card} testID="money-ai-pool">
      {budget ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`AI Usage: ${amount}`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
        >
          <Text style={styles.label}>
            AI Usage:{" "}
            <Text style={styles.amount} testID="money-ai-pool-amount">
              {amount}
            </Text>
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct}%` }]} testID="money-ai-pool-fill" />
          </View>
        </View>
      ) : query.error ? (
        <QuietError
          layout="inline"
          message={loadFailureMessage(query.error, "AI usage")}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          testID="money-ai-pool-error"
        />
      ) : (
        <QuietLoading label="Loading AI usage" rows={1} testID="money-ai-pool-loading" />
      )}
      {onBuy ? (
        <PrimaryButton
          label="Buy more credits"
          haptic={false}
          onPress={() => {
            void HapticService.mediumImpact();
            onBuy();
          }}
          accessibilityHint="Opens the credit pack checkout."
          testID="money-buy-credits"
          style={styles.buy}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      padding: 16,
      marginBottom: 12,
    },
    label: { ...typography.body, color: colors.textSecondary },
    amount: {
      fontFamily: "Inter_600SemiBold",
      color: colors.textPrimary,
      fontVariant: ["tabular-nums"],
    },
    track: {
      height: 6,
      borderRadius: radius.chip,
      backgroundColor: colors.divider,
      overflow: "hidden",
      marginTop: 10,
    },
    fill: { height: "100%", backgroundColor: colors.primary },
    buy: { marginTop: 16 },
  });
