/**
 * PurchaseFeedback — what the client sees around a purchase, shared by every
 * package-selling surface so the flow looks and reads the same everywhere:
 * progress ("Confirming your plan."), the calm slow state, the success
 * moment, the price-change confirmation, "you already have this plan", and
 * every specific failure notice (with a reference and Email support for the
 * unknown ones).
 */
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import type { SemanticTokens, Tokens } from "../../theme/tokens";
import {
  SupportEmailFallback,
  useSupportEmail,
} from "../support/SupportEmailFallback";
import { PACKAGE_PAYMENT_COPY } from "../../lib/packagePayment";
import { money } from "../../lib/planTerms";
import type { PackagePurchase } from "../../hooks/usePackagePurchase";
import PlanTermsBlock from "./PlanTermsBlock";

export interface PurchaseFeedbackProps {
  purchase: PackagePurchase;
  /** Leave the purchase surface (after success or the slow state). */
  onContinue: () => void;
  /** Open the client's plan (already active, or to check where it stands). */
  onOpenPlan: (purchaseId: string | null) => void;
}

export default function PurchaseFeedback({
  purchase,
  onContinue,
  onOpenPlan,
}: PurchaseFeedbackProps) {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(
    () => makeStyles(semanticColors, tokens),
    [semanticColors, tokens],
  );
  const { state } = purchase;
  const notice = state.notice;
  const supportEmail = useSupportEmail(
    PACKAGE_PAYMENT_COPY.supportSubject(notice?.reference ?? null),
  );

  const progress =
    state.phase === "starting"
      ? PACKAGE_PAYMENT_COPY.starting
      : state.phase === "confirming"
        ? state.saleKind === "free"
          ? PACKAGE_PAYMENT_COPY.confirmingFree
          : state.saleKind === "one_time"
            ? state.checking
              ? PACKAGE_PAYMENT_COPY.checkingPayment
              : PACKAGE_PAYMENT_COPY.confirming
            : PACKAGE_PAYMENT_COPY.confirmingPlan
        : null;

  return (
    <View>
      {progress ? (
        <Text
          style={styles.status}
          accessibilityLiveRegion="polite"
          testID="payment-confirming"
        >
          {progress}
        </Text>
      ) : null}

      {state.phase === "success" && state.success ? (
        <View
          style={styles.success}
          testID="payment-success"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.successTitle} accessibilityRole="header">
            {state.success.title}
          </Text>
          <Text style={styles.body}>{state.success.body}</Text>
          <Primary
            label={PACKAGE_PAYMENT_COPY.continue}
            onPress={onContinue}
            styles={styles}
            testID="payment-continue"
          />
        </View>
      ) : null}

      {state.phase === "confirm_slow" ? (
        <View
          style={styles.block}
          testID="payment-confirm-slow"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.body}>
            {state.slowMessage ?? PACKAGE_PAYMENT_COPY.confirmSlow}
          </Text>
          <Secondary
            label={PACKAGE_PAYMENT_COPY.checkAgain}
            onPress={() => void purchase.checkAgain()}
            styles={styles}
            testID="payment-check-again"
          />
          <Primary
            label={PACKAGE_PAYMENT_COPY.continue}
            onPress={onContinue}
            styles={styles}
            testID="payment-continue"
          />
        </View>
      ) : null}

      {state.phase === "confirmed_pending" ? (
        <View style={styles.block} testID="payment-confirmed-pending">
          <Text style={styles.body}>
            {state.saleKind === "free"
              ? PACKAGE_PAYMENT_COPY.confirmedPendingFree
              : PACKAGE_PAYMENT_COPY.confirmedPending}
          </Text>
          <Primary
            label={PACKAGE_PAYMENT_COPY.continue}
            onPress={onContinue}
            styles={styles}
            testID="payment-continue"
          />
        </View>
      ) : null}

      {state.priceChange ? (
        <View style={styles.block} testID="price-changed">
          <Text
            style={styles.body}
            accessibilityRole="alert"
            testID="price-changed-message"
          >
            {state.priceChange.message ??
              PACKAGE_PAYMENT_COPY.priceChanged(
                money(
                  state.priceChange.oldCents,
                  state.priceChange.pkg.currency,
                ),
                money(
                  state.priceChange.newCents,
                  state.priceChange.pkg.currency,
                ),
              )}
          </Text>
          <PlanTermsBlock
            pkg={state.priceChange.pkg}
            testID="price-changed-terms"
          />
          <Primary
            label={
              state.priceChange.confirmLabel ??
              PACKAGE_PAYMENT_COPY.confirmNewPrice(
                money(
                  state.priceChange.newCents,
                  state.priceChange.pkg.currency,
                ),
              )
            }
            onPress={() => void purchase.confirmNewPrice()}
            styles={styles}
            testID="price-confirm-btn"
          />
        </View>
      ) : null}

      {notice ? (
        <View style={styles.block}>
          <Text
            style={notice.tone === "info" ? styles.body : styles.error}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="payment-error"
          >
            {notice.message}
          </Text>
          {notice.checkAgain ? (
            <Secondary
              label={PACKAGE_PAYMENT_COPY.checkAgain}
              onPress={() => void purchase.checkAgain()}
              styles={styles}
              testID="payment-check-again"
            />
          ) : null}
          {state.alreadyActive || notice.openPlan ? (
            <Secondary
              label={PACKAGE_PAYMENT_COPY.openPlan}
              onPress={() =>
                onOpenPlan(state.alreadyActive?.purchaseId ?? null)
              }
              styles={styles}
              testID="payment-open-plan"
            />
          ) : null}
          {notice.support ? (
            <>
              {notice.reference ? (
                <Text
                  selectable
                  style={styles.reference}
                  testID="payment-error-reference"
                >
                  {`Reference ${notice.reference}`}
                </Text>
              ) : null}
              <Pressable
                onPress={() => {
                  void supportEmail.open();
                }}
                accessibilityRole="button"
                accessibilityLabel={PACKAGE_PAYMENT_COPY.supportAction}
                hitSlop={8}
                style={styles.linkBtn}
                testID="payment-support"
              >
                <Text style={styles.link}>
                  {PACKAGE_PAYMENT_COPY.supportAction}
                </Text>
              </Pressable>
              <SupportEmailFallback
                handle={supportEmail}
                textStyle={styles.body}
                linkColor={semanticColors.accentText}
                testID="payment-support-fallback"
              />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Primary({
  label,
  onPress,
  styles,
  testID,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.primary}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function Secondary({
  label,
  onPress,
  styles,
  testID,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.linkBtn}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      testID={testID}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    status: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: c.textPrimary,
      marginBottom: 12,
    },
    block: { marginBottom: 12, gap: 6 },
    success: {
      borderWidth: 1,
      borderColor: c.accent,
      backgroundColor: c.bgSurface,
      padding: 16,
      marginBottom: 12,
      gap: 8,
    },
    successTitle: {
      fontFamily: "CormorantGaramond_400Regular",
      fontSize: 24,
      lineHeight: 28,
      color: c.textPrimary,
    },
    body: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: c.textPrimary,
    },
    error: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 19,
      color: tokens.colors.error,
    },
    reference: {
      fontFamily: "Inter_500Medium",
      fontSize: 13,
      color: c.textMuted,
    },
    linkBtn: {
      minHeight: 44,
      justifyContent: "center",
      alignSelf: "flex-start",
    },
    link: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: c.accentText,
      textDecorationLine: "underline",
    },
    primary: {
      backgroundColor: c.accent,
      minHeight: 48,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
    },
    primaryText: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 14,
      letterSpacing: 1.2,
      color: c.textOnAccent,
    },
  });
