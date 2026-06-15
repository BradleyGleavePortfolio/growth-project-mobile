/**
 * RefundDecisionCard — F2 partial-refund coach-decision surface.
 *
 * Renders ON the affected client's profile when a partial refund has fired and
 * a PartialRefundDecision is still 'pending'. The coach chooses:
 *   • "Keep client's drops"     → decision='keep_drops' (drops untouched)
 *   • "Unassign client's drops" → decision='unassign_drops' (pending drops
 *                                  canceled server-side)
 *
 * Flag-gated by `featureFlags.namedRegimes`: when OFF this component renders
 * null (mounts nothing) so the surface is invisible until the flag flips.
 *
 * Standardized on semanticColors / tokens.ts (bgSurface, never `surface`).
 */
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useDecideRefund } from '../../hooks/useRegimes';
import { romanPartialRefundDecided } from '../../lib/roman/copy';
import type { PendingRefundDecision } from '../../types/regimes';

export interface RefundDecisionCardProps {
  decision: PendingRefundDecision;
  testID?: string;
}

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RefundDecisionCard({
  decision,
  testID,
}: RefundDecisionCardProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const decide = useDecideRefund();

  const styles = useMemo(() => makeStyles(), []);

  // Flag-off doctrine: the card never mounts while the feature is hidden.
  if (!featureFlags.namedRegimes) return null;

  const pending = decide.isPending;

  return (
    <View
      testID={testID ?? 'refund-decision-card'}
      style={[
        styles.card,
        {
          backgroundColor: semanticColors.bgSurface,
          borderColor: semanticColors.border,
        },
      ]}
    >
      <Text style={[styles.title, { color: semanticColors.textPrimary }]}>
        Partial refund issued
      </Text>
      <Text style={[styles.body, { color: semanticColors.textMuted }]}>
        {formatAmount(decision.amount_cents)} was refunded. The client keeps
        access. Decide what happens to their scheduled drops.
      </Text>

      {decide.isSuccess && decide.data ? (
        <Text
          testID="refund-decision-confirmation"
          style={[styles.body, { color: semanticColors.textMuted }]}
        >
          {romanPartialRefundDecided({ decision: decide.data.decision })}
        </Text>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            testID="refund-keep-drops"
            accessibilityRole="button"
            disabled={pending}
            onPress={() =>
              decide.mutate({
                refundId: decision.stripe_refund_id,
                decision: 'keep_drops',
              })
            }
            style={[styles.button, { borderColor: semanticColors.border }]}
          >
            <Text style={[styles.buttonText, { color: semanticColors.textPrimary }]}>
              Keep client&rsquo;s drops
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="refund-unassign-drops"
            accessibilityRole="button"
            disabled={pending}
            onPress={() =>
              decide.mutate({
                refundId: decision.stripe_refund_id,
                decision: 'unassign_drops',
              })
            }
            style={[styles.button, { backgroundColor: semanticColors.accent }]}
          >
            <Text style={[styles.buttonText, { color: semanticColors.textOnAccent }]}>
              Unassign client&rsquo;s drops
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {pending ? (
        <ActivityIndicator testID="refund-decision-spinner" style={styles.spinner} />
      ) : null}
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    button: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '600',
    },
    spinner: {
      marginTop: spacing.xs,
    },
  });
}
