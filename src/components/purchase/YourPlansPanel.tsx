/**
 * YourPlansPanel — the client's renewing plans, native in Membership plans
 * (OR-110-2: no hosted billing pages): what each plan costs, the next charge
 * or the date access ends, and End my plan / Keep my plan.
 *
 *   GET  /v1/checkout/subscriptions              (backend #654)
 *   POST /v1/checkout/subscriptions/:id/resume   (backend #654, plan view)
 *   POST /v1/checkout/subscriptions/:id/cancel   (dunning D3/D4, CancelPlanResult)
 *
 * Voluntary End my plan keeps access through the paid period; during dunning
 * it ends access now and voids the unpaid invoice (owner ruling 2A). The
 * answer of every action is shown; an older list read never overwrites a
 * newer answer (B-344-3). A missing list route or a failed read is said, never
 * hidden (B-344-1). Failures get plan copy and a support path (B-344-4/6).
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
  listClientPlans,
  PACKAGE_PAYMENT_COPY,
  resumeClientPlan,
  type ClientPlan,
  type PackagePaymentNotice,
} from "../../lib/packagePayment";
import {
  cancelPlan,
  describePlanActionFailure,
  describePlansListFailure,
  PLAN_ACTION_COPY,
  PLANS_LIST_COPY,
  planDate as dateOf,
  type CancelOutcome,
  type PlansListFailure,
} from "../../lib/planActions";
import { cadenceCopy, money } from "../../lib/planTerms";
import {
  SupportEmailFallback,
  useSupportEmail,
} from "../support/SupportEmailFallback";

export const YOUR_PLANS_COPY = {
  title: "Your plans",
  endPlan: "End my plan",
  keepPlan: "Keep my plan",
  endConfirmTitle: "End this plan?",
  // B-344-2: the server ends now (2A) whenever it holds a payment as overdue.
  endConfirmBody: (date: string | null) =>
    `${date ? `Your plan stays active until ${date}` : "Your plan stays active until the end of the current period"}, and nothing more is charged after that. If a payment is overdue, ending it ends access now instead and cancels the unpaid charge.`,
  staleTitle: "Refresh your plans first",
  staleBody:
    "The latest details of this plan could not load, so it is not confirmed what ending it would do. Refresh your plans before choosing End my plan.",
  staleRefresh: "Refresh plans",
  endConfirmAction: "End plan",
  endConfirmKeep: "Keep plan",
  // B-344-2/5: dunning (owner ruling 2A), with the paid-meanwhile race.
  endNowTitle: "End this plan now?",
  endNowBody:
    "The last payment did not go through, so ending this plan ends access now and cancels the unpaid charge, so it is never collected. If that payment went through in the meantime, access continues through the period it paid for instead. Nothing more is charged after that.",
  endNowAction: "End plan now",
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
  // B-344-5: the native Update card is not on this tree (lockout #352-#354).
  pastDue:
    "The last payment did not go through. To keep this plan, message your coach about the payment. To end it now, choose End my plan.",
  paymentFailed:
    "The first payment for this plan did not go through, so it has not started and nothing more is charged. Choose the plan below to start it with another card.",
  endedNow: "This plan has ended. Nothing more is charged.",
  confirming:
    "Confirming this plan with Stripe. It shows here within a minute.",
} as const;

function afterCancel(p: ClientPlan, o: CancelOutcome): ClientPlan {
  return o.outcome === "scheduled"
    ? {
        ...p,
        cancelAtPeriodEnd: true,
        accessEndsAt: o.accessEndsAt ?? p.accessEndsAt,
        nextChargeAt: null,
        canCancel: false,
      }
    : {
        ...p,
        state: "ended",
        entitlementActive: false,
        nextChargeAt: null,
        accessEndsAt: o.accessEndsAt,
        canCancel: false,
        canResume: false,
      };
}

type ListState = { kind: "loading" | "ready" } | PlansListFailure;
/** B-344-3: a cancel receipt and the generation it was answered at. */
type Receipt = { result: CancelOutcome; trial: boolean; gen: number };

// B-344-7: Stripe's period end during a trial is the trial end.
const endsInTrial = (p: ClientPlan, o: CancelOutcome) =>
  p.state === "trialing" &&
  !!o.accessEndsAt &&
  !!p.trialEndsAt &&
  Date.parse(o.accessEndsAt) <= Date.parse(p.trialEndsAt);

/** B-344-3: a receipt stands only while a newer read agrees with it. */
const agrees = (r: Receipt, p: ClientPlan | undefined) =>
  !!p &&
  (r.result.outcome === "scheduled"
    ? p.cancelAtPeriodEnd && p.state !== "ended"
    : p.state === "ended");

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
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [outcomes, setOutcomes] = useState<Record<string, Receipt>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    purchaseId: string;
    notice: PackagePaymentNotice;
  } | null>(null);
  const listRef = list.kind === "failed" ? list.reference : null;
  const supportEmail = useSupportEmail(
    PLAN_ACTION_COPY.supportSubject(notice?.notice.reference ?? listRef),
  );
  const resumeKeys = useRef<Record<string, string>>({});
  const busy = useRef(false);
  // B-344-3: only the newest read or action answer is published.
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await listClientPlans();
      if (!mounted.current || mine !== generation.current) return;
      setPlans(next);
      setList({ kind: "ready" });
      setOutcomes((o) => {
        const keep = Object.entries(o).filter(
          ([id, r]) =>
            r.gen >= mine ||
            agrees(
              r,
              next.find((p) => p.purchaseId === id),
            ),
        );
        return keep.length === Object.keys(o).length
          ? o
          : Object.fromEntries(keep);
      });
    } catch (err) {
      if (!mounted.current || mine !== generation.current) return;
      setList(describePlansListFailure(err));
    }
  }, []);

  const shownKey = useRef(reloadKey);
  useEffect(() => {
    if (shownKey.current !== reloadKey) {
      shownKey.current = reloadKey;
      setOutcomes({});
    }
    void load();
  }, [load, reloadKey]);

  const runAction = useCallback(
    async (plan: ClientPlan, action: "cancel" | "resume") => {
      if (busy.current || !mounted.current) return;
      busy.current = true;
      setBusyId(plan.purchaseId);
      setNotice(null);
      const id = plan.purchaseId;
      try {
        if (action === "cancel") {
          const outcome = await cancelPlan(id);
          if (!mounted.current) return;
          const gen = ++generation.current;
          if (outcome) {
            setPlans((ps) =>
              ps.map((p) =>
                p.purchaseId === id ? afterCancel(p, outcome) : p,
              ),
            );
            setOutcomes((o) => ({
              ...o,
              [id]: { result: outcome, trial: endsInTrial(plan, outcome), gen },
            }));
          }
        } else {
          const key = resumeKeys.current[id] ?? generateIdempotencyKey();
          resumeKeys.current[id] = key;
          const updated = await resumeClientPlan(id, key);
          delete resumeKeys.current[id];
          if (!mounted.current) return;
          generation.current += 1;
          if (updated?.purchaseId === id)
            setPlans((ps) =>
              ps.map((p) => (p.purchaseId === id ? updated : p)),
            );
          setOutcomes((o) => {
            const next = { ...o };
            delete next[id];
            return next;
          });
        }
        await load();
      } catch (err) {
        if (!mounted.current) return;
        const n = describePlanActionFailure(err, action);
        setNotice({ purchaseId: id, notice: n });
        if (n.reload) void load();
      } finally {
        busy.current = false;
        if (mounted.current) setBusyId(null);
      }
    },
    [load],
  );

  const stale = list.kind === "failed" || list.kind === "unavailable";
  const confirmEnd = useCallback(
    (plan: ClientPlan) => {
      // B-344-2: no End my plan from a card no read has confirmed.
      if (stale)
        return Alert.alert(
          YOUR_PLANS_COPY.staleTitle,
          YOUR_PLANS_COPY.staleBody,
          [
            { text: YOUR_PLANS_COPY.endConfirmKeep, style: "cancel" },
            { text: YOUR_PLANS_COPY.staleRefresh, onPress: () => void load() },
          ],
        );
      const now = plan.state === "past_due";
      Alert.alert(
        now ? YOUR_PLANS_COPY.endNowTitle : YOUR_PLANS_COPY.endConfirmTitle,
        now
          ? YOUR_PLANS_COPY.endNowBody
          : YOUR_PLANS_COPY.endConfirmBody(
              dateOf(plan.nextChargeAt ?? plan.trialEndsAt),
            ),
        [
          { text: YOUR_PLANS_COPY.endConfirmKeep, style: "cancel" },
          {
            text: now
              ? YOUR_PLANS_COPY.endNowAction
              : YOUR_PLANS_COPY.endConfirmAction,
            style: "destructive",
            onPress: () => void runAction(plan, "cancel"),
          },
        ],
      );
    },
    [load, runAction, stale],
  );

  const support = (
    <>
      <Pressable
        onPress={() => void supportEmail.open()}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={PACKAGE_PAYMENT_COPY.supportAction}
        testID="your-plans-support"
      >
        <Text style={styles.actionText}>
          {PACKAGE_PAYMENT_COPY.supportAction}
        </Text>
      </Pressable>
      <SupportEmailFallback
        handle={supportEmail}
        textStyle={styles.line}
        linkColor={semanticColors.accentText}
        testID="your-plans-support-fallback"
      />
    </>
  );
  const retry = (
    <Pressable
      onPress={() => void load()}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={`${PLANS_LIST_COPY.retry}, ${YOUR_PLANS_COPY.title}`}
      testID="your-plans-retry"
    >
      <Text style={styles.actionText}>{PLANS_LIST_COPY.retry}</Text>
    </Pressable>
  );

  const visible = plans.filter(
    (p) => p.state !== "ended" || outcomes[p.purchaseId],
  );
  if (visible.length === 0) {
    if (list.kind !== "unavailable" && list.kind !== "failed") return null;
    return (
      <View style={styles.wrap} testID={`your-plans-${list.kind}`}>
        <Text style={styles.title} accessibilityRole="header">
          {YOUR_PLANS_COPY.title}
        </Text>
        <Text style={styles.line} accessibilityLiveRegion="polite">
          {list.kind === "unavailable"
            ? PLANS_LIST_COPY.unavailable
            : list.offline
              ? PLANS_LIST_COPY.offline
              : PLANS_LIST_COPY.failed(list.reference)}
        </Text>
        {list.kind === "failed" ? retry : null}
        {list.kind === "failed" && !list.offline ? support : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap} testID="your-plans">
      <Text style={styles.title} accessibilityRole="header">
        {YOUR_PLANS_COPY.title}
      </Text>
      {stale ? (
        <View testID="your-plans-stale">
          <Text style={styles.line} accessibilityLiveRegion="polite">
            {list.kind === "failed"
              ? PLANS_LIST_COPY.stale
              : PLANS_LIST_COPY.unavailable}
          </Text>
          {list.kind === "failed" ? retry : null}
        </View>
      ) : null}
      {visible.map((plan) => {
        const amount = `${money(plan.amountCents, plan.currency)} ${cadenceCopy(plan.interval ?? "month", plan.intervalCount)}`;
        const receipt = outcomes[plan.purchaseId];
        const line = receipt
          ? PLAN_ACTION_COPY.outcome(receipt.result, receipt.trial)
          : plan.state === "ended"
            ? YOUR_PLANS_COPY.endedNow
            : plan.state === "confirming"
              ? YOUR_PLANS_COPY.confirming
              : plan.state === "past_due"
                ? YOUR_PLANS_COPY.pastDue
                : plan.state === "payment_failed"
                  ? YOUR_PLANS_COPY.paymentFailed
                  : plan.cancelAtPeriodEnd
                    ? YOUR_PLANS_COPY.ended(dateOf(plan.accessEndsAt))
                    : plan.state === "trialing"
                      ? YOUR_PLANS_COPY.trial(amount, dateOf(plan.trialEndsAt))
                      : YOUR_PLANS_COPY.renews(
                          amount,
                          dateOf(plan.nextChargeAt),
                        );
        const isBusy = busyId === plan.purchaseId;
        const n = notice?.purchaseId === plan.purchaseId ? notice.notice : null;
        return (
          <View
            key={plan.purchaseId}
            style={styles.card}
            testID={`your-plan-${plan.purchaseId}`}
          >
            <Text style={styles.name}>{plan.packageName}</Text>
            <Text
              style={styles.line}
              accessibilityLiveRegion="polite"
              testID={`your-plan-line-${plan.purchaseId}`}
            >
              {line}
            </Text>
            {n ? (
              <Text
                style={styles.error}
                accessibilityRole="alert"
                testID="your-plan-error"
              >
                {n.message}
                {n.reference && !n.message.includes(n.reference)
                  ? ` Reference ${n.reference}.`
                  : null}
              </Text>
            ) : null}
            {n?.support ? support : null}
            {plan.canCancel ? (
              <Pressable
                onPress={() => confirmEnd(plan)}
                disabled={isBusy}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={`${YOUR_PLANS_COPY.endPlan}, ${plan.packageName}`}
                accessibilityState={{ disabled: isBusy, busy: isBusy }}
                testID={`your-plan-end-${plan.purchaseId}`}
              >
                <Text style={styles.actionText}>{YOUR_PLANS_COPY.endPlan}</Text>
              </Pressable>
            ) : null}
            {plan.canResume ? (
              <Pressable
                onPress={() => void runAction(plan, "resume")}
                disabled={isBusy}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={`${YOUR_PLANS_COPY.keepPlan}, ${plan.packageName}`}
                accessibilityState={{ disabled: isBusy, busy: isBusy }}
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
