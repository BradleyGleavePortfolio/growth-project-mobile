/**
 * S-COACH — Home checklist: Get paid, first package, invite first client,
 * first client payment. Every tick comes from a live route:
 *   Get paid        GET /coach/connect/status (state === 'active')
 *   First package   GET /v1/coach/packages (any live package)
 *   Invite          the coach shared or copied their link on this device
 *   First payment   GET /v1/coach/money/charges?status=paid&limit=1
 *                   (older backend: the first-payment celebration gate)
 * The first payment itself is celebrated by FirstPaymentWowHost (flag
 * EXPO_PUBLIC_FF_ROMAN_FIRST_PAYMENT_WOW). The card hides once all four are done.
 */
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import api from "../../../services/api";
import { coachSetupApi } from "../../../api/coachSetupApi";
import { coachPackagesApi } from "../../../api/packagesApi";
import { prefsStorage } from "../../../storage/mmkv";
import { hasSeenFirstPayment } from "../../../screens/coach/ed/firstPaymentGate";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { errorStatus } from "../../../types/common";

// Same key InviteShareCard writes when the coach shares or copies the link.
export const INVITE_SHARED_KEY_BASE = "coach.setup.invite_shared";

export function inviteSharedKey(coachId: string): string {
  return `${INVITE_SHARED_KEY_BASE}:${coachId}`;
}

export type ChecklistTarget = "get_paid" | "package" | "invite" | "money";

export interface ChecklistItem {
  key: ChecklistTarget;
  label: string;
  detail: string;
  done: boolean;
}

interface Status {
  connectActive: boolean | null;
  connectNeedsAttention: boolean;
  hasPackage: boolean | null;
  invited: boolean;
  paid: boolean | null;
}

/** Pure builder so the copy and order are testable. */
export function buildChecklist(s: Status): ChecklistItem[] {
  return [
    {
      key: "get_paid",
      label: "Get paid",
      detail: s.connectActive
        ? "Stripe is ready to pay you."
        : s.connectNeedsAttention
          ? "Stripe needs a few more details from you."
          : "Connect Stripe so clients can pay you.",
      done: s.connectActive === true,
    },
    {
      key: "package",
      label: "Create your first package",
      detail: s.hasPackage
        ? "Your package is live."
        : "Free, or $19.99 and up.",
      done: s.hasPackage === true,
    },
    {
      key: "invite",
      label: "Invite your first client",
      detail: s.invited
        ? "You shared your invite link."
        : "Share your link or QR code.",
      done: s.invited,
    },
    {
      key: "money",
      label: "Get your first client payment",
      detail: s.paid
        ? "You have been paid. See it in Money."
        : "We will mark the moment with you when it lands.",
      done: s.paid === true,
    },
  ];
}

interface Props {
  onOpen: (target: ChecklistTarget) => void;
}

export default function CoachSetupChecklist({ onOpen }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const user = useCurrentUser();
  const coachId = user?.id ?? null;
  const [status, setStatus] = useState<Status | null>(null);

  const load = useCallback(async () => {
    if (!coachId) return;
    const [connect, packages, paid, invited] = await Promise.all([
      coachSetupApi.connectStatus().catch(() => null),
      coachPackagesApi.list().catch(() => null),
      api
        .get<{ charges?: unknown[] }>("/v1/coach/money/charges", {
          params: { status: "paid", limit: 1 },
        })
        .then((r) =>
          Array.isArray(r.data?.charges) ? r.data.charges.length > 0 : null,
        )
        .catch(async (err) =>
          errorStatus(err) === 404 ? hasSeenFirstPayment(coachId) : null,
        ),
      prefsStorage
        .getStringAsync(inviteSharedKey(coachId))
        .then((v) => v === "true")
        .catch(() => false),
    ]);
    setStatus({
      connectActive: connect ? connect.state === "active" : null,
      connectNeedsAttention: connect
        ? connect.actionRequired && connect.state !== "not_started"
        : false,
      hasPackage: packages
        ? packages.data.some((p) => p.status === "active")
        : null,
      invited,
      paid,
    });
  }, [coachId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!status) return null;
  const items = buildChecklist(status);
  const remaining = items.filter((i) => !i.done).length;
  if (remaining === 0) return null;
  return (
    <View style={styles.card} testID="coach-setup-checklist">
      <Text style={styles.title} accessibilityRole="header">
        Finish setting up
      </Text>
      <Text
        style={styles.sub}
      >{`${items.length - remaining} of ${items.length} done`}</Text>
      {items.map((it) => (
        <TouchableOpacity
          key={it.key}
          style={styles.row}
          onPress={() => onOpen(it.key)}
          accessibilityRole="button"
          accessibilityLabel={`${it.label}. ${it.done ? "Done" : "To do"}. ${it.detail}`}
          testID={`coach-setup-checklist-${it.key}`}
        >
          <View style={[styles.dot, it.done && styles.dotDone]} />
          <View style={styles.rowText}>
            <Text style={[styles.label, it.done && styles.labelDone]}>
              {it.label}
            </Text>
            <Text style={styles.detail}>{it.detail}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 16,
      marginBottom: 16,
    },
    title: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 17,
      color: colors.textPrimary,
    },
    sub: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 2,
      marginBottom: 8,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 56,
      paddingVertical: 6,
    },
    dot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: colors.primary,
      marginRight: 12,
    },
    dotDone: { backgroundColor: colors.primary },
    rowText: { flex: 1 },
    label: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 15,
      color: colors.textPrimary,
    },
    labelDone: { color: colors.textSecondary },
    detail: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });
