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
 *
 * LS-914R2 B2: as in the C5 frames, the two actions sit in the host's pinned,
 * inset-safe bottom bar, not under the content. A host reads the moment once
 * with usePlanMoment, passes it to PlanActiveMoment (content only) and puts
 * PlanActiveActions in its footer (or PlanActiveBar where it has none).
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
import { attemptPurchase, formatPlanDate, paidAmount } from "../../lib/planTerms";
import { useTheme } from "../../theme/ThemeProvider";
import {
  colors,
  layout,
  motion,
  radius,
  SERIF_MIN_LINE_RATIO,
  typography,
  type SemanticTokens,
} from "../../theme/tokens";
import { PrimaryButton, TextLink, footerBottomPadding, useScreenInsets } from "../../ui";
import { HapticService } from "../../ui/haptics/haptics.service";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING_MS = 300;

/** The coach's initial (or a check when the name is unknown) in a camel ring. */
export function CoachMark({
  name,
  size,
  draw = false,
  ring = 1.5,
  ringColor = colors.camel,
  initialSize,
}: {
  name: string | null;
  size: number;
  draw?: boolean;
  /** Ring width, drawn inside `size` (C5 seal: 2 around a 72 disc). */
  ring?: number;
  ringColor?: string;
  /** Italic initial at this size (C5 seal: 40); default upright 0.42 x size. */
  initialSize?: number;
}) {
  const { semanticColors: sc } = useTheme();
  const r = size / 2 - ring / 2;
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
          stroke={ringColor}
          strokeWidth={ring}
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
              initialSize
                ? {
                    color: colors.forest,
                    fontFamily: "CormorantGaramond_500Medium",
                    fontWeight: "500",
                    fontStyle: "italic",
                    fontSize: initialSize,
                    lineHeight: Math.ceil(initialSize * SERIF_MIN_LINE_RATIO),
                  }
                : { color: colors.forest, fontSize: size * 0.42, lineHeight: size * 0.6 },
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

/** What the moment shows: this purchase's own row and the coach's name. */
export interface PlanMoment {
  row: ClientPurchase | null;
  coach: string | null;
}

/**
 * Reads the moment once for a host (null while there is no success). The
 * content and the pinned actions both use this one read.
 */
export function usePlanMoment(success: PurchaseSuccess | null): PlanMoment {
  const [row, setRow] = useState<ClientPurchase | null>(null);
  const [coach, setCoach] = useState<string | null>(null);
  const packageId = success?.packageId ?? null;
  const purchaseId = success?.purchaseId ?? null;
  useEffect(() => {
    setRow(null);
    setCoach(null);
    if (!packageId) return undefined;
    let live = true;
    void clientPaymentsApi.getPurchases().then((res) => {
      if (!live || !res.ok) return;
      // The confirmed row, else this purchase's own row (the newest of the
      // package) once it is in force; never an older purchase (LS-PAYFAIL B7).
      const mine = attemptPurchase(res.data, packageId, purchaseId);
      setRow(mine && (purchaseId || mine.entitlement_active) ? mine : null);
    });
    api
      .get<{ name?: string }>("/v1/clients/me/coach")
      .then((res) => live && setCoach(res.data?.name ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [purchaseId, packageId]);
  return useMemo(() => ({ row, coach }), [row, coach]);
}

export interface PlanActiveActionsProps {
  moment: PlanMoment;
  onContinue: () => void;
  /** Open what the purchase unlocks (More stack only); omitted elsewhere. */
  onSeeUnlocks?: (purchaseId: string) => void;
}

/** See what unlocks (when there is something to open) and Done. */
export function PlanActiveActions({ moment, onContinue, onSeeUnlocks }: PlanActiveActionsProps) {
  const { row } = moment;
  const unlock =
    onSeeUnlocks && featureFlags.deliverables && row
      ? () => onSeeUnlocks(row.id)
      : null;
  return unlock ? (
    <>
      <PrimaryButton
        label={COPY.seeWhatUnlocks}
        onPress={unlock}
        testID="payment-see-unlocks"
      />
      {/* C5 .link: forest, 14. */}
      <TextLink
        label={COPY.done}
        onPress={onContinue}
        tone="accent"
        size="small"
        testID="payment-continue"
      />
    </>
  ) : (
    <PrimaryButton
      label={COPY.done}
      onPress={onContinue}
      testID="payment-continue"
    />
  );
}

/**
 * The pinned, inset-safe bottom bar for hosts whose layout has no footer
 * (the package sheet and the package detail). Same padding as Screen's footer.
 */
export function PlanActiveBar(props: PlanActiveActionsProps) {
  const { semanticColors } = useTheme();
  const insets = useScreenInsets();
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: semanticColors.bgPrimary, paddingBottom: footerBottomPadding(insets.bottom) },
      ]}
      testID="payment-success-footer"
    >
      <PlanActiveActions {...props} />
    </View>
  );
}

export interface PlanActiveMomentProps {
  success: PurchaseSuccess;
  onContinue: () => void;
  /** Open what the purchase unlocks (More stack only); omitted elsewhere. */
  onSeeUnlocks?: (purchaseId: string) => void;
  /**
   * The host's read (usePlanMoment). When given, the host shows the actions
   * in its pinned bar and this draws the content only.
   */
  moment?: PlanMoment;
}

export default function PlanActiveMoment({
  success,
  onContinue,
  onSeeUnlocks,
  moment: hosted,
}: PlanActiveMomentProps) {
  const { semanticColors } = useTheme();
  const s = useMemo(() => makeStyles(semanticColors), [semanticColors]);
  const own = usePlanMoment(hosted ? null : success);
  const { row, coach } = hosted ?? own;

  useEffect(() => {
    void HapticService.success();
  }, []);

  const paid = row ? paidAmount(row) : null;
  const nextIso =
    row?.billing_type === "recurring" && !row.cancel_at_period_end
      ? row.current_period_end
      : null;
  const next =
    nextIso && !Number.isNaN(Date.parse(nextIso))
      ? formatPlanDate(new Date(nextIso))
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
      {/* C5 seal: a 72 disc in a 2 pt gold ring, the initial in italic. */}
      <CoachMark
        name={coach}
        size={SEAL + 2 * SEAL_RING}
        ring={SEAL_RING}
        ringColor={colors.romanAccent}
        initialSize={40}
        draw
      />
      <Text style={s.title} accessibilityRole="header">
        {success.title}
      </Text>
      <Text style={s.body}>{success.body}</Text>
      {lines.length > 0 ? (
        <View style={s.card} testID="payment-success-receipt">
          <View style={s.rule} />
          {lines.map((l) => (
            <View key={l.id}>
              <View
                style={s.line}
                accessible
                accessibilityLabel={`${l.label}, ${l.value}`}
                testID={`payment-success-${l.id}`}
              >
                <Text style={s.label}>{l.label}</Text>
                <Text style={s.value}>{l.value}</Text>
              </View>
              {/* One dashed edge: RN draws dashes only on a full border. */}
              <View style={s.dashClip}>
                <View style={s.dash} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {hosted ? null : (
        <View style={s.actions}>
          <PlanActiveActions moment={own} onContinue={onContinue} onSeeUnlocks={onSeeUnlocks} />
        </View>
      )}
    </View>
  );
}

// C5 (MOCK-C5 C_success.html): .c-s.lg 72 x 72 with a 2 px gold ring.
const SEAL = 72;
const SEAL_RING = 2;

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  bar: {
    paddingHorizontal: layout.gutter,
    paddingTop: layout.footerTopGap,
    gap: layout.footerItemGap,
  },
});

// Geometry from MOCK-C5 C_success.html (.c-ok, .c-slip, .c-kv). The title
// keeps a 40 line (not 36.8): serif lines stay >= 1.25 x size (B15 guard).
function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    wrap: { alignItems: "center", paddingTop: 10, paddingBottom: 2 },
    title: {
      ...typography.h1,
      fontFamily: "CormorantGaramond_500Medium",
      fontWeight: "500",
      letterSpacing: -0.2,
      color: sc.textPrimary,
      textAlign: "center",
      marginTop: 12,
    },
    body: {
      ...typography.bodySmall,
      lineHeight: 21,
      color: colors.charcoal,
      textAlign: "center",
      marginTop: 8,
    },
    card: {
      alignSelf: "stretch",
      marginTop: 8,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: sc.border,
      backgroundColor: sc.bgSurface,
      overflow: "hidden",
      padding: 16,
    },
    rule: {
      position: "absolute",
      top: 0,
      left: 16,
      right: 16,
      height: 2,
      backgroundColor: colors.romanAccent,
    },
    line: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "baseline",
      columnGap: 12,
      rowGap: 4,
      paddingVertical: 9,
    },
    dashClip: { height: 1, overflow: "hidden" },
    dash: {
      height: 2,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: sc.border,
    },
    label: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, color: sc.textMuted },
    value: {
      ...typography.bodyMd,
      fontSize: 15,
      lineHeight: 21,
      color: sc.textPrimary,
      fontVariant: ["tabular-nums"],
      flexShrink: 1,
      textAlign: "right",
    },
    actions: { alignSelf: "stretch", marginTop: 28, gap: 8, alignItems: "center" },
  });
}
