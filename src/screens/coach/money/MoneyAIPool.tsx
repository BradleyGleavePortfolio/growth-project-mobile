/**
 * PK-2 (owner 2026-10-12): the coach's AI pool on the Money page as a bar and
 * in numbers (the Coach Home meter's "AI Usage" line, same budget query), with
 * "Buy more credits" right under it (CreditPackCheckout; PK-1 Option 1: the
 * coach picks the pack there). No onBuy where packs are not sold: the pool
 * shows alone. Loading and failure reuse the Settings AI credits row's words.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { UseAIBudgetResult } from "../../../hooks/useAIBudget";
import { clampPctForDisplay, formatCents } from "../../../api/types/coachAIBudget";
import { PrimaryButton, QuietTextButton } from "../../../ui";
import { AI_CREDITS_LOAD_FAILED } from "../settings/AICreditsRow";
import { errorStatus } from "../../../types/common";
import { QuietError, QuietLoading } from "../../../ui/states/QuietStates";
import { HapticService } from "../../../ui/haptics/haptics.service";
import { useTheme, type ThemeColors } from "../../../theme/ThemeProvider";
import { radius, typography } from "../../../theme/tokens";

interface Props {
  query: Pick<UseAIBudgetResult, "data" | "error" | "isFetching" | "refetch">;
  onBuy?: () => void;
  /** The page already shows a filled button (Stripe setup): buy as quiet text. */
  quiet?: boolean;
}

const HINT = "Opens the credit pack checkout.";

export default function MoneyAIPool({ query, onBuy, quiet = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const budget = query.data;
  const pct = budget ? clampPctForDisplay(budget.pct_used) : 0;
  const amount = budget
    ? `${formatCents(budget.used_displayed_cents)} / ${formatCents(budget.total_displayed_cents)}`
    : "";
  // 403: this account has no AI pool of its own (sub_coach role). Nothing to show or buy.
  if (!budget && errorStatus(query.error) === 403) return null;
  const buy = (haptic: "mediumImpact" | "softImpact") => () => {
    void HapticService[haptic]();
    onBuy?.();
  };
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
          message={AI_CREDITS_LOAD_FAILED}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          testID="money-ai-pool-error"
        />
      ) : (
        <QuietLoading label="AI credits, loading" rows={1} testID="money-ai-pool-loading" />
      )}
      {onBuy && quiet ? (
        <QuietTextButton label="Buy more credits" onPress={buy("softImpact")} accessibilityHint={HINT} testID="money-buy-credits" style={styles.quietBuy} />
      ) : onBuy ? (
        <PrimaryButton label="Buy more credits" accessibilityLabel="Buy more AI credits" haptic={false} onPress={buy("mediumImpact")} accessibilityHint={HINT} testID="money-buy-credits" style={styles.buy} />
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.card,
      backgroundColor: colors.surface, padding: 16, marginBottom: 12,
    },
    label: { ...typography.body, color: colors.textSecondary },
    amount: {
      fontFamily: "Inter_600SemiBold",
      color: colors.textPrimary,
      fontVariant: ["tabular-nums"],
    },
    track: {
      height: 6, borderRadius: radius.chip, backgroundColor: colors.divider,
      overflow: "hidden", marginTop: 10,
    },
    fill: { height: "100%", backgroundColor: colors.primary },
    buy: { marginTop: 16 },
    quietBuy: { marginTop: 8, marginLeft: -4 },
  });
