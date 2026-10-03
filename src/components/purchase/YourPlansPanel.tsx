/**
 * YourPlansPanel — the client's renewing plans, native in Membership plans
 * (OR-110-2: no hosted billing pages): what each plan costs, the next charge
 * or the date access ends, and End my plan / Keep my plan.
 *
 *   GET  /v1/checkout/subscriptions              (backend #654)
 *   POST /v1/checkout/subscriptions/:id/resume   (backend #654)
 *   POST /v1/checkout/subscriptions/:id/cancel   (backend #628, cancel at period end)
 *
 * Ending a plan keeps access through the period already paid for (owner
 * 13:43). Every failure gets specific copy through describeBackendFailure.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import type { SemanticTokens, Tokens } from "../../theme/tokens";
import { generateIdempotencyKey } from "../../utils/idempotency";
import {
  cancelClientPlan,
  describeBackendFailure,
  listClientPlans,
  resumeClientPlan,
  type ClientPlan,
  type PackagePaymentNotice,
} from "../../lib/packagePayment";
import { cadenceCopy, formatPlanDate, money } from "../../lib/planTerms";

export const YOUR_PLANS_COPY = {
  title: "Your plans",
  endPlan: "End my plan",
  keepPlan: "Keep my plan",
  endConfirmTitle: "End this plan?",
  endConfirmBody: (date: string | null) =>
    date
      ? `Your plan stays active until ${date}, and nothing more is charged after that.`
      : "Your plan stays active until the end of the period you paid for, and nothing more is charged after that.",
  endConfirmAction: "End plan",
  endConfirmKeep: "Keep plan",
  ended: (date: string | null) =>
    date
      ? `Ends on ${date}. Nothing more is charged.`
      : "Ends at the close of this period. Nothing more is charged.",
  renews: (amount: string, date: string | null) =>
    date ? `Next charge of ${amount} on ${date}.` : `Renews at ${amount}.`,
  trial: (amount: string, date: string | null) =>
    date
      ? `Free trial until ${date}, then ${amount}.`
      : `Free trial, then ${amount}.`,
  pastDue:
    "The last payment did not go through. Update your card from the payment notice in the app to keep this plan.",
  confirming:
    "Confirming this plan with Stripe. It shows here within a minute.",
} as const;

function dateOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : formatPlanDate(d);
}

export default function YourPlansPanel({
  reloadKey = 0,
}: {
  reloadKey?: number;
}) {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(
    () => makeStyles(semanticColors, tokens),
    [semanticColors, tokens],
  );
  const [plans, setPlans] = useState<ClientPlan[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    purchaseId: string;
    notice: PackagePaymentNotice;
  } | null>(null);
  const resumeKeys = useRef<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await listClientPlans();
      if (mounted.current) setPlans(list.filter((p) => p.state !== "ended"));
    } catch {
      // The plans list above still works; this panel stays hidden.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const runAction = useCallback(
    async (plan: ClientPlan, action: "cancel" | "resume") => {
      if (busyId) return;
      setBusyId(plan.purchaseId);
      setNotice(null);
      try {
        if (action === "cancel") {
          await cancelClientPlan(plan.purchaseId);
        } else {
          const key =
            resumeKeys.current[plan.purchaseId] ?? generateIdempotencyKey();
          resumeKeys.current[plan.purchaseId] = key;
          await resumeClientPlan(plan.purchaseId, key);
          delete resumeKeys.current[plan.purchaseId];
        }
        await load();
      } catch (err) {
        if (mounted.current) {
          setNotice({
            purchaseId: plan.purchaseId,
            notice: describeBackendFailure(err, "plan_action", null),
          });
        }
      } finally {
        if (mounted.current) setBusyId(null);
      }
    },
    [busyId, load],
  );

  const confirmEnd = useCallback(
    (plan: ClientPlan) => {
      Alert.alert(
        YOUR_PLANS_COPY.endConfirmTitle,
        YOUR_PLANS_COPY.endConfirmBody(
          dateOf(plan.nextChargeAt ?? plan.trialEndsAt),
        ),
        [
          { text: YOUR_PLANS_COPY.endConfirmKeep, style: "cancel" },
          {
            text: YOUR_PLANS_COPY.endConfirmAction,
            style: "destructive",
            onPress: () => void runAction(plan, "cancel"),
          },
        ],
      );
    },
    [runAction],
  );

  if (plans.length === 0) return null;

  return (
    <View style={styles.wrap} testID="your-plans">
      <Text style={styles.title} accessibilityRole="header">
        {YOUR_PLANS_COPY.title}
      </Text>
      {plans.map((plan) => {
        const amount = `${money(plan.amountCents, plan.currency)} ${cadenceCopy(plan.interval ?? "month", plan.intervalCount)}`;
        const line =
          plan.state === "confirming"
            ? YOUR_PLANS_COPY.confirming
            : plan.state === "past_due" || plan.state === "payment_failed"
              ? YOUR_PLANS_COPY.pastDue
              : plan.cancelAtPeriodEnd
                ? YOUR_PLANS_COPY.ended(dateOf(plan.accessEndsAt))
                : plan.state === "trialing"
                  ? YOUR_PLANS_COPY.trial(amount, dateOf(plan.trialEndsAt))
                  : YOUR_PLANS_COPY.renews(amount, dateOf(plan.nextChargeAt));
        const busy = busyId === plan.purchaseId;
        const n = notice?.purchaseId === plan.purchaseId ? notice.notice : null;
        return (
          <View
            key={plan.purchaseId}
            style={styles.card}
            testID={`your-plan-${plan.purchaseId}`}
          >
            <Text style={styles.name}>{plan.packageName}</Text>
            <Text style={styles.line}>{line}</Text>
            {n ? (
              <Text
                style={styles.error}
                accessibilityRole="alert"
                testID="your-plan-error"
              >
                {n.message}
                {n.reference ? ` Reference ${n.reference}.` : ""}
              </Text>
            ) : null}
            {plan.canCancel ? (
              <Pressable
                onPress={() => confirmEnd(plan)}
                disabled={busy}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={`${YOUR_PLANS_COPY.endPlan}, ${plan.packageName}`}
                accessibilityState={{ disabled: busy, busy }}
                testID={`your-plan-end-${plan.purchaseId}`}
              >
                <Text style={styles.actionText}>{YOUR_PLANS_COPY.endPlan}</Text>
              </Pressable>
            ) : null}
            {plan.canResume ? (
              <Pressable
                onPress={() => void runAction(plan, "resume")}
                disabled={busy}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={`${YOUR_PLANS_COPY.keepPlan}, ${plan.packageName}`}
                accessibilityState={{ disabled: busy, busy }}
                testID={`your-plan-keep-${plan.purchaseId}`}
              >
                <Text style={styles.actionText}>
                  {YOUR_PLANS_COPY.keepPlan}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    wrap: { marginBottom: 16, gap: 8 },
    title: {
      fontSize: 13,
      fontWeight: "600",
      color: c.textMuted,
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    card: {
      backgroundColor: c.bgSurface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      gap: 4,
    },
    name: { fontSize: 16, fontWeight: "600", color: c.textPrimary },
    line: { fontSize: 13, lineHeight: 19, color: c.textMuted },
    error: { fontSize: 13, lineHeight: 19, color: tokens.colors.error },
    action: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    actionText: {
      fontSize: 13,
      fontWeight: "600",
      color: c.accentText,
      textDecorationLine: "underline",
    },
  });
