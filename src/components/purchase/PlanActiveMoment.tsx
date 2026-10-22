/**
 * PlanActiveMoment — C5 slice 2, Style C (`clientBillingV2` on): the success
 * moment after a plan is bought, inline in the purchase surface (the doctrine
 * bans full-screen celebration overlays). The coach's initial in a camel ring
 * that draws once in 300 ms (static under Reduce Motion), the existing title
 * and sentence, then a receipt card with the server's numbers only: Paid from
 * purchases[].first_charge_cents (no line in a trial or when unknown) and
 * Next charge from the purchase's period end. See what unlocks shows when
 * deliverables are on and the purchase row is found; Done leaves. One success
 * haptic when the moment appears.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import api from "../../services/api";
import {
  clientPaymentsApi,
  type ClientPurchase,
} from "../../api/clientPaymentsApi";
import { featureFlags } from "../../config/featureFlags";
import type { PurchaseSuccess } from "../../hooks/usePackagePurchase";
import { PACKAGE_PAYMENT_COPY as COPY } from "../../lib/packagePayment";
import { formatPlanDate, paidAmount } from "../../lib/planTerms";
import { useTheme } from "../../theme/ThemeProvider";
import {
  colors,
  motion,
  radius,
  typography,
  type SemanticTokens,
} from "../../theme/tokens";
import { PrimaryButton, TextLink } from "../../ui";
import { NewCoachLine } from "../renewal/CoachMonogram";
import { HapticService } from "../../ui/haptics/haptics.service";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING_MS = 300;

/** The coach's initial (or a check when the name is unknown) in a camel ring. */
export function CoachMark({
  name,
  size,
  draw = false,
}: {
  name: string | null;
  size: number;
  draw?: boolean;
}) {
  const { semanticColors: sc } = useTheme();
  const r = size / 2 - 1.5;
  const length = 2 * Math.PI * r;
  const offset = useRef(new Animated.Value(draw ? length : 0)).current;
  useEffect(() => {
    if (!draw) return undefined;
    let live = true;
    // No motion until the Reduce Motion answer is known; then draw once.
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (reduce) => {
        if (!live) return;
        if (reduce) offset.setValue(0);
        else
          Animated.timing(offset, {
            toValue: 0,
            duration: RING_MS,
            easing: Easing.bezier(...motion.easing.decel),
            useNativeDriver: false,
          }).start();
      },
      () => live && offset.setValue(0),
    );
    return () => {
      live = false;
      offset.stopAnimation();
    };
  }, [draw, offset]);
  const initial = name?.trim().charAt(0).toUpperCase() ?? "";
  return (
    <View
      style={{ width: size, height: size }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID="coach-mark"
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill={sc.bgSurface} />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colors.camel}
          strokeWidth={1.5}
          strokeDasharray={`${length} ${length}`}
          strokeDashoffset={offset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        {initial ? (
          <Text
            allowFontScaling={false}
            style={[
              typography.h1,
              { color: colors.forest, fontSize: size * 0.42, lineHeight: size * 0.6 },
            ]}
          >
            {initial}
          </Text>
        ) : (
          <Ionicons name="checkmark" size={size * 0.4} color={colors.forest} />
        )}
      </View>
    </View>
  );
}

export interface PlanActiveMomentProps {
  success: PurchaseSuccess;
  onContinue: () => void;
  /** Open what the purchase unlocks (More stack only); omitted elsewhere. */
  onSeeUnlocks?: (purchaseId: string) => void;
  newCoachName?: string; // RENEWAL-M H3: the client just joined this coach (the house coach)
}

export default function PlanActiveMoment({
  success,
  onContinue,
  onSeeUnlocks,
  newCoachName,
}: PlanActiveMomentProps) {
  const { semanticColors } = useTheme();
  const s = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const [row, setRow] = useState<ClientPurchase | null>(null);
  const [coach, setCoach] = useState<string | null>(null);

  useEffect(() => {
    void HapticService.success();
  }, []);

  useEffect(() => {
    let live = true;
    void clientPaymentsApi.getPurchases().then((res) => {
      if (!live || !res.ok) return;
      // The confirmed row, else the newest entitled row for the package.
      const found = res.data.find((p) =>
        success.purchaseId
          ? p.id === success.purchaseId
          : p.package_id === success.packageId && p.entitlement_active,
      );
      setRow(found ?? null);
    });
    api
      .get<{ name?: string }>("/v1/clients/me/coach")
      .then((res) => live && setCoach(res.data?.name ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [success.purchaseId, success.packageId]);

  const paid = row ? paidAmount(row) : null;
  const nextIso =
    row?.billing_type === "recurring" && !row.cancel_at_period_end
      ? row.current_period_end
      : null;
  const next =
    nextIso && !Number.isNaN(Date.parse(nextIso))
      ? formatPlanDate(new Date(nextIso))
      : null;
  const unlock =
    onSeeUnlocks && featureFlags.deliverables && row
      ? () => onSeeUnlocks(row.id)
      : null;
  const lines: { id: string; label: string; value: string }[] = [];
  if (paid) lines.push({ id: "paid", label: COPY.paid, value: paid });
  if (next) lines.push({ id: "next", label: COPY.nextCharge, value: next });

  return (
    <View
      style={s.wrap}
      testID="payment-success"
      accessibilityLiveRegion="polite"
    >
      <CoachMark name={coach} size={96} draw />
      <Text style={s.title} accessibilityRole="header">
        {success.title}
      </Text>
      <NewCoachLine name={newCoachName} />
      <Text style={s.body}>{success.body}</Text>
      {lines.length > 0 ? (
        <View style={s.card} testID="payment-success-receipt">
          <View style={s.rule} />
          {lines.map((l, i) => (
            <View
              key={l.id}
              style={[s.line, i > 0 && s.lineGap]}
              accessible
              accessibilityLabel={`${l.label}, ${l.value}`}
              testID={`payment-success-${l.id}`}
            >
              <Text style={s.label}>{l.label}</Text>
              <Text style={s.value}>{l.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={s.actions}>
        {unlock ? (
          <>
            <PrimaryButton
              label={COPY.seeWhatUnlocks}
              onPress={unlock}
              testID="payment-see-unlocks"
            />
            <TextLink
              label={COPY.done}
              onPress={onContinue}
              testID="payment-continue"
            />
          </>
        ) : (
          <PrimaryButton
            label={COPY.done}
            onPress={onContinue}
            testID="payment-continue"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    wrap: { alignItems: "center", paddingTop: 24, paddingBottom: 8 },
    title: {
      ...typography.h1,
      color: sc.textPrimary,
      textAlign: "center",
      marginTop: 20,
    },
    body: {
      ...typography.body,
      color: sc.textMuted,
      textAlign: "center",
      marginTop: 12,
    },
    card: {
      alignSelf: "stretch",
      marginTop: 24,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: sc.border,
      backgroundColor: sc.bgSurface,
      overflow: "hidden",
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    rule: {
      height: 2,
      backgroundColor: colors.camel,
      marginHorizontal: -20,
      marginBottom: 4,
    },
    line: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "baseline",
      columnGap: 12,
      paddingTop: 12,
    },
    lineGap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: sc.border,
      marginTop: 12,
    },
    label: { ...typography.body, color: sc.textMuted },
    value: {
      ...typography.bodyMd,
      color: sc.textPrimary,
      fontVariant: ["tabular-nums"],
      flexShrink: 1,
      textAlign: "right",
    },
    actions: { alignSelf: "stretch", marginTop: 28, gap: 8, alignItems: "center" },
  });
}
