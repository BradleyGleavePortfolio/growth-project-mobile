/**
 * COACH-PAY-M-130: one client's payments, for their coach (owner: coaches
 * have to be able to issue refunds). Per plan: its price, its billing state
 * in words and only the actions the backend allows (pause, resume, cancel,
 * restart); per payment: when it was paid, what was refunded, and Refund.
 * Opened from the client's Summary actions while /me/feature-flags reports
 * coach_payment_actions (backend CF-COACH-PAY-BE-128). Bone page, hairline
 * sections; the one filled forest button is Refund in the refund sheet.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RouteProp } from "@react-navigation/native";
import { coachClientPaymentsApi, type ClientPayment, type ClientPlan } from "../../api/coachClientPaymentsApi";
import { RESTART_CONFIRM_TITLE, restartConfirmBody } from "../../components/coach/DisputePausedPlansCard";
import SetupNotice from "../../components/coach/setup/SetupNotice";
import { restartDisputePausedPlan } from "../../entitlements/dunning/coachDisputeRestart";
import {
  actionFailure, amountText, changeDone, confirmCopy, parseAmount, paymentLine,
  planStateLine, priceLine, refundConsequence, refundDone, type PlanChange,
} from "../../lib/money/clientPaymentsCopy";
import { SUB_COACH_BILLING_BLOCKED } from "../../lib/coachSetup/errors";
import { noteHeadCoachHandlesMoney } from "../../lib/money/headCoachRole";
import { money, shortDate } from "../../lib/money/moneyCopy";
import { useTheme } from "../../theme/ThemeProvider";
import { typography, type SemanticTokens } from "../../theme/tokens";
import { QuietOverline, QuietSection, quietActions } from "../../ui/sections/QuietSection";
import { SkeletonScreen } from "../../ui/skeletons/Skeleton";
import { generateIdempotencyKey } from "../../utils/idempotency";
import MoneyBack from "./money/MoneyBack";
import { useSection } from "./money/useSection";

export interface ClientPaymentsParams {
  clientId: string;
  clientName?: string;
}

interface Props {
  route: RouteProp<{ ClientPayments: ClientPaymentsParams }, "ClientPayments">;
}

const WHAT: Record<PlanChange, string> = {
  pause: "pause billing on this plan",
  resume: "resume billing on this plan",
  cancel: "cancel this plan",
};

export default function ClientPaymentsScreen({ route }: Props): React.ReactElement {
  const { clientId, clientName = "" } = route.params;
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
  const section = useSection(
    () => coachClientPaymentsApi.list(clientId),
    "load this client's payments",
    [clientId],
  );
  const { reload } = section;
  // Plans returned by an action, until the next list replaces them.
  const [fresh, setFresh] = useState<Record<string, ClientPlan>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ purchaseId: string; text: string } | null>(null);
  const [sheet, setSheet] = useState<{ plan: ClientPlan; payment: ClientPayment } | null>(null);

  useEffect(() => {
    setFresh({});
  }, [section.loadedAt]);
  // A sub-coach's money is their head coach's: hide Summary > Payments from now on.
  useEffect(() => {
    if (section.error?.code === SUB_COACH_BILLING_BLOCKED) noteHeadCoachHandlesMoney(true);
  }, [section.error]);

  const plans = (section.data ?? []).map((p) => fresh[p.purchaseId] ?? p);
  const settle = useCallback((plan: ClientPlan, text: string) => {
    setFresh((prev) => ({ ...prev, [plan.purchaseId]: plan }));
    setNotice({ purchaseId: plan.purchaseId, text });
  }, []);

  const runChange = useCallback(
    async (plan: ClientPlan, change: PlanChange, key: string) => {
      setBusy(plan.purchaseId);
      setNotice(null);
      try {
        const out = await coachClientPaymentsApi.change(clientId, plan.purchaseId, change, key);
        settle(out.plan, changeDone(change, out.plan, out.message));
      } catch (err) {
        setNotice({ purchaseId: plan.purchaseId, text: actionFailure(err, WHAT[change]) });
        void reload();
      } finally {
        setBusy(null);
      }
    },
    [clientId, reload, settle],
  );

  const confirmChange = (plan: ClientPlan, change: PlanChange) => {
    const c = confirmCopy(change, plan, clientName);
    // One key per confirmed tap: a lost reply retried by the app is the same tap.
    const key = generateIdempotencyKey();
    Alert.alert(c.title, c.body, [
      { text: c.keep, style: "cancel" },
      {
        text: c.confirm,
        style: change === "cancel" ? "destructive" : "default",
        onPress: () => void runChange(plan, change, key),
      },
    ]);
  };

  const confirmRestart = (plan: ClientPlan) => {
    const reason = plan.status === "refunded" ? "refund" : "dispute";
    Alert.alert(RESTART_CONFIRM_TITLE, restartConfirmBody(clientName, reason), [
      { text: "Not now", style: "cancel" },
      {
        text: "Restart plan",
        onPress: () => {
          setBusy(plan.purchaseId);
          setNotice(null);
          void restartDisputePausedPlan(plan.purchaseId).then((out) => {
            setNotice({ purchaseId: plan.purchaseId, text: out.message });
            setBusy(null);
            void reload();
          });
        },
      },
    ]);
  };

  const actionsOf = (plan: ClientPlan): Array<{ label: string; run: () => void; quiet?: boolean }> => {
    const out: Array<{ label: string; run: () => void; quiet?: boolean }> = [];
    if (plan.actions.pause) out.push({ label: "Pause billing", run: () => confirmChange(plan, "pause") });
    if (plan.actions.resume) out.push({ label: "Resume billing", run: () => confirmChange(plan, "resume") });
    if (plan.actions.restart) out.push({ label: "Restart plan", run: () => confirmRestart(plan) });
    if (plan.actions.cancel) out.push({ label: "Cancel plan", run: () => confirmChange(plan, "cancel"), quiet: true });
    return out;
  };

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.inner}
        testID="client-payments-screen"
        refreshControl={
          <RefreshControl
            refreshing={section.loading && section.data !== null}
            onRefresh={() => {
              setNotice(null);
              void reload();
            }}
            tintColor={sc.textMuted}
          />
        }
      >
        <MoneyBack testID="client-payments-back" />
        <QuietOverline>Payments</QuietOverline>
        <Text style={styles.title} accessibilityRole="header">
          {clientName || "This client"}
        </Text>

        {section.error ? (
          <SetupNotice error={section.error} onRetry={() => void reload()} testID="client-payments-error" />
        ) : null}
        {section.loading && section.data === null ? (
          <SkeletonScreen count={4} testID="client-payments-loading" />
        ) : null}
        {section.data !== null && plans.length === 0 ? (
          <Text style={styles.body} testID="client-payments-empty">
            {`${clientName || "This client"} has not paid for any of your packages yet. Payments show here once they do.`}
          </Text>
        ) : null}

        {plans.map((plan) => {
          const actions = actionsOf(plan);
          const isBusy = busy === plan.purchaseId;
          return (
            <QuietSection key={plan.purchaseId} testID={`plan-${plan.purchaseId}`}>
              <QuietOverline>{plan.packageName}</QuietOverline>
              <Text style={styles.price}>{priceLine(plan)}</Text>
              <Text style={styles.muted} testID={`plan-state-${plan.purchaseId}`}>
                {planStateLine(plan, clientName)}
              </Text>
              {actions.length > 0 ? (
                <View style={quietActions.row}>
                  {actions.map((a) => (
                    <Pressable
                      key={a.label}
                      onPress={a.run}
                      disabled={busy !== null}
                      style={quietActions.action}
                      accessibilityRole="button"
                      accessibilityLabel={`${a.label}, ${plan.packageName}`}
                      accessibilityState={{ disabled: busy !== null, busy: isBusy }}
                      testID={`plan-action-${a.label.toLowerCase().replace(/ /g, "-")}-${plan.purchaseId}`}
                    >
                      <Text style={[quietActions.label, { color: a.quiet ? sc.textMuted : sc.accentText }]}>
                        {a.label}
                      </Text>
                    </Pressable>
                  ))}
                  {isBusy ? <ActivityIndicator color={sc.textMuted} /> : null}
                </View>
              ) : null}
              {notice?.purchaseId === plan.purchaseId ? (
                <Text style={styles.notice} accessibilityLiveRegion="polite" testID={`plan-notice-${plan.purchaseId}`}>
                  {notice.text}
                </Text>
              ) : null}
              {plan.payments.length === 0 ? (
                <Text style={styles.muted}>No payment has gone through on this plan yet.</Text>
              ) : null}
              {plan.payments.map((pay) => (
                <View key={pay.chargeId} style={styles.payment} testID={`payment-${pay.chargeId}`}>
                  <View style={styles.paymentText}>
                    <Text style={styles.amount}>{money(pay.amountCents, pay.currency)}</Text>
                    <Text style={styles.muted}>{paymentLine(pay)}</Text>
                  </View>
                  {plan.actions.refund && pay.refundableCents > 0 ? (
                    <Pressable
                      onPress={() => setSheet({ plan, payment: pay })}
                      disabled={busy !== null}
                      style={quietActions.action}
                      accessibilityRole="button"
                      accessibilityLabel={`Refund the ${money(pay.amountCents, pay.currency)} payment from ${shortDate(pay.paidAt) ?? "this plan"}`}
                      testID={`payment-refund-${pay.chargeId}`}
                    >
                      <Text style={[quietActions.label, { color: sc.accentText }]}>Refund</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </QuietSection>
          );
        })}
      </ScrollView>

      {sheet ? (
        <RefundSheet
          key={sheet.payment.chargeId}
          clientId={clientId}
          clientName={clientName}
          plan={sheet.plan}
          payment={sheet.payment}
          styles={styles}
          sc={sc}
          onClose={() => setSheet(null)}
          onDone={(plan, text) => {
            setSheet(null);
            settle(plan, text);
          }}
          onFailed={() => void reload()}
        />
      ) : null}
    </SafeAreaView>
  );
}

function RefundSheet(props: {
  clientId: string;
  clientName: string;
  plan: ClientPlan;
  payment: ClientPayment;
  styles: ReturnType<typeof makeStyles>;
  sc: SemanticTokens;
  onClose: () => void;
  onDone: (plan: ClientPlan, text: string) => void;
  onFailed: () => void;
}) {
  const { plan, payment: pay, styles, sc, clientName } = props;
  const [text, setText] = useState(amountText(pay.refundableCents, pay.currency));
  // Kept across retries of the same amount, so a lost reply never refunds twice.
  const [key, setKey] = useState(generateIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseAmount(text, pay.currency);
  const cents = parsed !== null && parsed >= 1 && parsed <= pay.refundableCents ? parsed : null;
  const effect = cents === null ? null : refundConsequence(plan, pay, cents, clientName);

  const confirm = async () => {
    if (cents === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await coachClientPaymentsApi.refund(props.clientId, plan.purchaseId, {
        chargeId: pay.chargeId,
        amountCents: cents,
        idempotencyKey: key,
      });
      props.onDone(out.plan, refundDone(out.status, out.amountCents, pay.currency, clientName));
    } catch (err) {
      setBusy(false);
      setError(actionFailure(err, "refund this payment"));
      props.onFailed();
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !busy && props.onClose()}>
      <KeyboardAvoidingView
        style={styles.scrimWrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: sc.overlay }]}
          onPress={() => !busy && props.onClose()}
          accessibilityLabel="Close refund"
          accessibilityRole="button"
        />
        <View style={styles.sheet} testID="refund-sheet">
          <QuietOverline>{`Refund, ${plan.packageName}`}</QuietOverline>
          <Text style={styles.price} accessibilityRole="header">
            {`${money(pay.amountCents, pay.currency)} paid ${shortDate(pay.paidAt) ?? ""}`.trim()}
          </Text>
          <Text style={styles.muted}>
            {`Up to ${money(pay.refundableCents, pay.currency)} can be refunded. The money goes back to the card ${clientName || "the client"} paid with.`}
          </Text>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              setKey(generateIdempotencyKey());
              setError(null);
            }}
            editable={!busy}
            keyboardType="decimal-pad"
            style={styles.input}
            accessibilityLabel="Refund amount"
            testID="refund-amount"
          />
          <Text style={effect?.endsAccess ? styles.notice : styles.muted} testID="refund-consequence">
            {effect ? effect.text : `Enter an amount up to ${money(pay.refundableCents, pay.currency)}.`}
          </Text>
          {error ? (
            <Text style={styles.notice} accessibilityLiveRegion="polite" testID="refund-error">
              {error}
            </Text>
          ) : null}
          <Pressable
            onPress={() => void confirm()}
            disabled={cents === null || busy}
            style={[styles.primary, { backgroundColor: cents === null ? sc.disabledBg : sc.accent }]}
            accessibilityRole="button"
            accessibilityState={{ disabled: cents === null || busy, busy }}
            testID="refund-confirm"
          >
            {busy ? (
              <ActivityIndicator color={sc.textOnAccent} />
            ) : (
              <Text style={[styles.primaryLabel, { color: cents === null ? sc.textOnDisabled : sc.textOnAccent }]}>
                {cents === null
                  ? "Refund"
                  : `Refund ${money(cents, pay.currency)}${effect?.endsAccess ? " and end access" : ""}`}
              </Text>
            )}
          </Pressable>
          <Pressable
            onPress={props.onClose}
            disabled={busy}
            style={styles.secondary}
            accessibilityRole="button"
            testID="refund-keep"
          >
            <Text style={[quietActions.label, { color: sc.textMuted }]}>Not now</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const TABULAR = { fontVariant: ["tabular-nums" as const] };

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: sc.bgPrimary },
    inner: { paddingHorizontal: 20, paddingBottom: 48 },
    title: { ...typography.h1, color: sc.textPrimary, marginBottom: 24 },
    body: { ...typography.body, color: sc.textPrimary },
    muted: { ...typography.bodySmall, color: sc.textMuted, marginTop: 4 },
    notice: { ...typography.bodySmall, color: sc.textPrimary, marginTop: 8 },
    price: { ...typography.h2, ...TABULAR, color: sc.textPrimary },
    amount: { ...typography.bodyMd, ...TABULAR, color: sc.textPrimary },
    payment: {
      flexDirection: "row",
      alignItems: "center",
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: sc.border,
      paddingVertical: 12,
      marginTop: 12,
    },
    paymentText: { flex: 1, paddingRight: 12 },
    scrimWrap: { flex: 1, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: sc.bgPrimary,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      padding: 24,
      paddingBottom: 36,
    },
    label: { ...typography.bodySmall, color: sc.textMuted, marginTop: 20 },
    input: {
      ...typography.body,
      ...TABULAR,
      color: sc.textPrimary,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
      minHeight: 44,
      marginBottom: 4,
    },
    primary: { minHeight: 48, borderRadius: 4, alignItems: "center", justifyContent: "center", marginTop: 20 },
    primaryLabel: { ...typography.bodyMd },
    secondary: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  });
}
