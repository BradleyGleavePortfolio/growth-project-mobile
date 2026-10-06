/**
 * R-DISPUTE-PAUSE coach card on the client detail screen (the screen the
 * coach's dispute alert opens). Lists each of this client's plans that the
 * backend reports as paused by a payment dispute or inquiry, with a
 * "Restart plan" button behind a confirm dialog. Renders nothing when no
 * plan is dispute-paused or the read fails.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ThemeColors } from '../../theme/ThemeProvider';
import { formatCurrencyCents } from '../../utils/currency';
import {
  loadDisputePausedPlans,
  restartDisputePausedPlan,
  type DisputePausedPlan,
  type RestartOutcome,
} from '../../entitlements/dunning/coachDisputeRestart';

interface Props {
  clientUserId: string;
  clientName: string;
  /** Bumped by the screen's pull-to-refresh. */
  reloadKey?: number;
  colors: ThemeColors;
}

export const RESTART_CONFIRM_TITLE = 'Restart this plan?';
export function restartConfirmBody(clientName: string): string {
  return `Billing for ${clientName || 'the client'} resumes on the plan's usual schedule and access to the plan returns. Restart only once the payment dispute or inquiry is resolved or settled.`;
}

export function DisputePausedPlansCard({ clientUserId, clientName, reloadKey = 0, colors }: Props) {
  const [plans, setPlans] = useState<DisputePausedPlan[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, RestartOutcome>>({});

  useEffect(() => {
    let live = true;
    setOutcomes({});
    loadDisputePausedPlans(clientUserId)
      .then((list) => {
        if (live) setPlans(list);
      })
      .catch(() => {
        if (live) setPlans([]);
      });
    return () => {
      live = false;
    };
  }, [clientUserId, reloadKey]);

  const restart = useCallback(async (purchaseId: string) => {
    setBusyId(purchaseId);
    const out = await restartDisputePausedPlan(purchaseId);
    setOutcomes((prev) => ({ ...prev, [purchaseId]: out }));
    setBusyId(null);
  }, []);

  const confirmRestart = useCallback(
    (purchaseId: string) => {
      Alert.alert(RESTART_CONFIRM_TITLE, restartConfirmBody(clientName), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restart plan', onPress: () => void restart(purchaseId) },
      ]);
    },
    [clientName, restart],
  );

  if (plans.length === 0) return null;

  return (
    <View testID="dispute-paused-plans" style={[styles.card, { backgroundColor: colors.noticeWarningBg }]}>
      {plans.map((plan) => {
        const out = outcomes[plan.purchaseId];
        const amount =
          plan.amountCents !== null ? formatCurrencyCents(plan.amountCents, plan.currency ?? 'usd') : null;
        const showButton = !out || (!out.ok && !out.final);
        return (
          <View key={plan.purchaseId} style={styles.plan}>
            <Text style={[styles.title, { color: colors.noticeWarningText }]}>
              {out?.ok ? 'Plan restarted' : 'Plan paused after a payment dispute or inquiry'}
            </Text>
            {out?.ok ? null : (
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {`The bank opened a dispute or inquiry about a payment on this plan${
                  amount ? ` (${amount})` : ''
                }. Access to this plan has ended and its billing is paused until the plan is restarted.`}
              </Text>
            )}
            {out ? (
              <Text
                testID={`dispute-restart-outcome-${plan.purchaseId}`}
                accessibilityLiveRegion="polite"
                style={[styles.body, { color: out.ok ? colors.success : colors.textPrimary }]}
              >
                {out.message}
              </Text>
            ) : null}
            {showButton ? (
              <TouchableOpacity
                testID={`dispute-restart-${plan.purchaseId}`}
                accessibilityRole="button"
                accessibilityLabel="Restart plan"
                disabled={busyId !== null}
                onPress={() => confirmRestart(plan.purchaseId)}
                style={[styles.button, { backgroundColor: colors.primary }, busyId !== null && styles.dim]}
              >
                {busyId === plan.purchaseId ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={[styles.buttonText, { color: colors.textOnPrimary }]}>Restart plan</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 4, padding: 16, marginBottom: 16, gap: 16 },
  plan: { gap: 8 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 15, fontWeight: '600' },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  button: { alignSelf: 'flex-start', borderRadius: 4, paddingVertical: 10, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  dim: { opacity: 0.6 },
});
