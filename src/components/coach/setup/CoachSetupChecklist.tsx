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
 * "We could not check this" instead of looking undone. The first payment
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
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import {
  loadSetupStatus,
  type SetupSnapshot,
} from "../../../lib/coachSetup/setupStatus";
import { describeError } from "../../../lib/coachSetup/errors";
import SetupNotice from "./SetupNotice";

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

const UNKNOWN = "We could not check this just now.";

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
            ? "You have been paid."
            : "We will mark the moment with you when it lands.",
      done: s.paid,
    },
  ];
}

interface Props {
  /** `done` lets the host send a finished item somewhere useful. */
  onOpen: (target: ChecklistTarget, done: boolean | null) => void;
}

export default function CoachSetupChecklist({ onOpen }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const items = buildChecklist(toChecklistStatus(snap));
  const doneCount = items.filter((i) => i.done === true).length;
  if (doneCount === items.length) return null;
  return (
    <View style={styles.card} testID="coach-setup-checklist">
      <Text style={styles.title} accessibilityRole="header">
        Finish setting up
      </Text>
      <Text style={styles.sub}>{`${doneCount} of ${items.length} done`}</Text>
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
          />
          <View style={styles.rowText}>
            <Text style={[styles.label, it.done === true && styles.labelDone]}>
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
    dotUnknown: { borderColor: colors.textSecondary, borderStyle: "dashed" },
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
