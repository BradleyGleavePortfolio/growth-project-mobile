/**
 * S-COACH — Home checklist: Get paid, first package, first client, first
 * client payment. Every tick comes from a live route through
 * loadSetupStatus (src/lib/coachSetup/setupStatus.ts):
 *   Get paid        GET /coach/connect/status (state === 'active')
 *   First package   GET /v1/coach/packages (a live, published package)
 *   First client    GET /coach/clients (a client has joined)
 *   First payment   GET /v1/coach/money/charges?status=paid&limit=1
 *                   (older backend: the first-payment celebration gate)
 * A read that fails shows specific copy with a retry, and its item reads
 * "This could not be checked just now" instead of looking undone. The first payment
 * itself is celebrated by FirstPaymentWowHost (flag
 * EXPO_PUBLIC_FF_ROMAN_FIRST_PAYMENT_WOW). The card hides once all four are
 * done.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import { radius, typography } from "../../../theme/tokens";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import {
  loadSetupStatus,
  type SetupSnapshot,
} from "../../../lib/coachSetup/setupStatus";
import { describeError } from "../../../lib/coachSetup/errors";
import SetupNotice from "./SetupNotice";
import { CARD_A, SEMI, styleA } from "../../../screens/coach/home-v11/HomeParts";

export {
  INVITE_SHARED_KEY_BASE,
  inviteSharedKey,
} from "../../../lib/coachSetup/setupStatus";

export type ChecklistTarget = "get_paid" | "package" | "invite" | "money";

export interface ChecklistItem {
  key: ChecklistTarget;
  label: string;
  detail: string;
  /** null = the read failed, so we do not know. */
  done: boolean | null;
}

export interface ChecklistStatus {
  connectActive: boolean | null;
  connectNeedsAttention: boolean;
  hasPackage: boolean | null;
  hasClient: boolean | null;
  sharedLink: boolean;
  paid: boolean | null;
}

const UNKNOWN = "This could not be checked just now.";

export function toChecklistStatus(s: SetupSnapshot): ChecklistStatus {
  return {
    connectActive: s.connect ? s.connect.state === "active" : null,
    connectNeedsAttention: s.connect
      ? s.connect.actionRequired && s.connect.state !== "not_started"
      : false,
    hasPackage: s.livePackageTitle === null ? null : s.livePackageTitle !== "",
    hasClient: s.hasClient,
    sharedLink: s.sharedLink,
    paid: s.paid,
  };
}

/** Pure builder so the copy and order are testable. */
export function buildChecklist(s: ChecklistStatus): ChecklistItem[] {
  return [
    {
      key: "get_paid",
      label: "Get paid",
      detail:
        s.connectActive === null
          ? UNKNOWN
          : s.connectActive
            ? "Stripe is ready to pay you."
            : s.connectNeedsAttention
              ? "Stripe needs a few more details from you."
              : "Connect Stripe so clients can pay you.",
      done: s.connectActive,
    },
    {
      key: "package",
      label: "Create your first package",
      detail:
        s.hasPackage === null
          ? UNKNOWN
          : s.hasPackage
            ? "Your package is live."
            : "Free, or $19.99 and up.",
      done: s.hasPackage,
    },
    {
      key: "invite",
      label: "Invite your first client",
      detail:
        s.hasClient === null
          ? UNKNOWN
          : s.hasClient
            ? "Your first client has joined."
            : s.sharedLink
              ? "You shared your link. This ticks when your first client joins."
              : "Share your link or QR code.",
      done: s.hasClient,
    },
    {
      key: "money",
      label: "Get your first client payment",
      detail:
        s.paid === null
          ? UNKNOWN
          : s.paid
            ? "You have been paid. See it in Money."
            : "This ticks when your first client payment arrives.",
      done: s.paid,
    },
  ];
}

interface Props {
  /** `done` lets the host send a finished item somewhere useful. */
  onOpen: (target: ChecklistTarget, done: boolean | null) => void;
  /** "home": the coach Home's Style A card on the hero (HOME3 A `.setup`): white, a done bar, a tick circle and chevron per row. */
  look?: "card" | "home";
}

export default function CoachSetupChecklist({ onOpen, look = "card" }: Props) {
  const { colors, colorScheme } = useTheme();
  const home = look === "home";
  const light = colorScheme !== "dark";
  const base = useMemo(() => makeStyles(colors), [colors]);
  const hl = useMemo(() => makeHomeStyles(colors, light), [colors, light]);
  const styles = home ? hl : base;
  const user = useCurrentUser();
  const coachId = user?.id ?? null;
  const [snap, setSnap] = useState<SetupSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!coachId) return;
    setLoading(true);
    try {
      setSnap(await loadSetupStatus(coachId));
    } catch (err) {
      // loadSetupStatus settles every read; this only catches a bug in it.
      setSnap({
        connect: null,
        livePackageTitle: null,
        hasClient: null,
        paid: null,
        sharedLink: false,
        errors: [describeError(err, "check your setup")],
      });
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!snap) {
    return loading ? (
      <View style={styles.card} testID="coach-setup-checklist-loading">
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Checking your setup"
        />
      </View>
    ) : null;
  }
  // C-332-1 (Opus): an active sub-coach does not set up Stripe or
  // packages; the head coach's practice does.
  if (snap.headCoachHandlesMoney) return null;
  const items = buildChecklist(toChecklistStatus(snap));
  const doneCount = items.filter((i) => i.done === true).length;
  if (doneCount === items.length) return null;
  const count = <Text style={styles.sub}>{`${doneCount} of ${items.length} done`}</Text>;
  return (
    <View style={styles.card} testID="coach-setup-checklist">
      <View style={home ? hl.head : undefined}>
        <Text style={styles.title} accessibilityRole="header">
          Finish setting up
        </Text>
        {home ? count : null}
      </View>
      {home ? (
        <View style={hl.bar} testID="coach-setup-checklist-bar">
          <View style={[hl.barFill, { width: `${(doneCount / items.length) * 100}%` }]} testID="coach-setup-checklist-bar-fill" />
        </View>
      ) : (
        count
      )}
      {snap.errors.length > 0 ? (
        <SetupNotice
          error={snap.errors[0]}
          onRetry={loading ? undefined : () => void load()}
          testID="coach-setup-checklist-error"
        />
      ) : null}
      {items.map((it) => (
        <TouchableOpacity
          key={it.key}
          style={styles.row}
          onPress={() => onOpen(it.key, it.done)}
          accessibilityRole="button"
          accessibilityLabel={`${it.label}. ${
            it.done === null ? "Not checked" : it.done ? "Done" : "To do"
          }. ${it.detail}`}
          testID={`coach-setup-checklist-${it.key}`}
        >
          <View
            style={[
              styles.dot,
              it.done === true && styles.dotDone,
              it.done === null && styles.dotUnknown,
            ]}
            testID={`coach-setup-checklist-${it.key}-tick`}
          >
            {home && it.done === true ? <Ionicons name="checkmark" size={14} color={styleA.card} /> : null}
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.label, it.done === true && !home && styles.labelDone]}>
              {it.label}
            </Text>
            <Text style={styles.detail}>{it.detail}</Text>
          </View>
          {home ? <Ionicons name="chevron-forward" size={18} color={hl.chevron.color} /> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // COACH-HOME-134: rounded hairline card (Q10b) with a serif title.
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      padding: 20,
      marginBottom: 16,
    },
    title: {
      ...typography.h3,
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
      borderRadius: radius.chip,
      borderWidth: 2,
      borderColor: colors.primary,
      marginRight: 12,
    },
    dotDone: { backgroundColor: colors.primary },
    dotUnknown: { borderColor: colors.textSecondary, borderStyle: "dashed" },
    rowText: { flex: 1 },
    label: {
      ...typography.bodyMd,
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

/** HOME3 A's setup card (a.py `.setup`, `.st`, `.pbar`, `.step`, `.ck`, `.sl`, `.ss`); a dark scheme keeps the theme's surface and text. */
const makeHomeStyles = (colors: ThemeColors, light: boolean) =>
  StyleSheet.create({
    card: {
      ...CARD_A,
      ...(light ? null : { backgroundColor: colors.surface, borderColor: colors.border }),
      paddingTop: 14,
      paddingHorizontal: 16,
      paddingBottom: 4,
      marginBottom: 8,
    },
    head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
    title: { fontFamily: SEMI, fontSize: 16, lineHeight: 21, color: light ? styleA.ink : colors.textPrimary, flex: 1 },
    sub: { fontFamily: "Inter_400Regular", fontSize: 12.5, lineHeight: 17, color: light ? styleA.grey : colors.textSecondary },
    bar: { height: 6, borderRadius: radius.chip, backgroundColor: light ? styleA.cardLine : colors.border, overflow: "hidden", marginTop: 10, marginBottom: 6 },
    barFill: { height: 6, borderRadius: radius.chip, backgroundColor: colors.primary },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 50,
      paddingVertical: 5,
      borderTopWidth: 0.5,
      borderTopColor: light ? styleA.cardLine : colors.border,
    },
    dot: {
      width: 22,
      height: 22,
      borderRadius: radius.chip,
      borderWidth: 1.5,
      borderColor: light ? styleA.checkLine : colors.textSecondary, // A `.ck` #8A988E
      alignItems: "center",
      justifyContent: "center",
    },
    dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
    dotUnknown: { borderStyle: "dashed" },
    rowText: { flex: 1 },
    labelDone: {},
    label: { fontFamily: "Inter_500Medium", fontSize: 14.5, lineHeight: 19, color: light ? styleA.ink : colors.textPrimary },
    detail: { fontFamily: "Inter_400Regular", fontSize: 12.5, lineHeight: 17, color: light ? styleA.grey : colors.textSecondary },
    chevron: { color: light ? styleA.inkMuted : colors.textSecondary },
  });
