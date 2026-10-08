/**
 * S-MWB — small shared building blocks for the Programs screens: the failure
 * box (specific message, Try again, support path, reference; drawn by the
 * shared QuietError), chips and buttons.
 * Touch targets are at least 44pt and every control has an accessible label
 * (WCAG 2.2 AA: 2.5.8 target size, 4.1.2 name/role/value).
 */
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../../../theme/ThemeProvider";
import {
  QuietError,
  QuietLoading,
  type QuietErrorAction,
} from "../../../ui/states/QuietStates";
import type { ProgramFailure } from "../../../utils/programErrors";
import type { ProgramsNav } from "./types";

export function FailureBox({
  failure,
  onRetry,
  retryLabel = "Try again",
}: {
  failure: ProgramFailure;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const navigation = useNavigation<ProgramsNav>();
  // QA-COACH-STATES-131: the shared calm error. Sign in again replaces
  // Try again when the session ended; Contact support follows, muted.
  const signIn = failure.recovery === "sign_in";
  const actions: QuietErrorAction[] = [];
  if (signIn) {
    actions.push({
      label: "Sign in again",
      // Loaded on demand so the Programs screens do not pull the whole auth
      // stack in at import time.
      onPress: () => {
        void import("../../../services/authActions").then((m) => m.signOut());
      },
      accessibilityHint: "Signs you out so you can sign back in",
    });
  }
  if (failure.support) {
    actions.push({
      label: "Contact support",
      onPress: () => navigation.navigate("SupportInbox"),
      accessibilityHint: failure.reference
        ? `Opens support chat. Quote reference ${failure.reference}`
        : "Opens support chat",
    });
  }
  return (
    <QuietError
      layout="inline"
      message={failure.message}
      onRetry={signIn ? undefined : onRetry}
      retryLabel={retryLabel}
      retryHint={
        failure.recovery === "wait"
          ? "Runs the action again; wait a minute first"
          : "Runs the action again"
      }
      actions={actions}
    />
  );
}

export function SmallButton({
  label,
  onPress,
  disabled,
  tone = "neutral",
  accessibilityHint,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
  accessibilityHint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useTheme();
  const bg = tone === "primary" ? colors.primary : colors.surface;
  const fg =
    tone === "primary"
      ? colors.textOnPrimary
      : tone === "danger"
        ? colors.error
        : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.smallButton,
        {
          backgroundColor: bg,
          borderColor: tone === "primary" ? colors.primary : colors.border,
        },
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.8 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text style={[styles.smallButtonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: selected ? colors.textOnPrimary : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The shared skeleton; the label is spoken, not printed (QA-COACH-STATES-131). */
export function LoadingRow({ label }: { label: string }) {
  return <QuietLoading label={label} />;
}

export function SectionTitle({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[styles.section, { color: colors.textPrimary }]}
    >
      {children}
    </Text>
  );
}

/** "4 weeks x 3 days" with correct singulars. */
export function weeksByDays(weeks: number, days: number): string {
  return `${weeks} ${weeks === 1 ? "week" : "weeks"} x ${days} ${days === 1 ? "day" : "days"}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const styles = StyleSheet.create({
  smallButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  smallButtonText: { fontSize: 14, fontWeight: "600" },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: "center",
  },
  chipText: { fontSize: 14, fontWeight: "600" },
  section: { fontSize: 17, fontWeight: "600", marginTop: 16, marginBottom: 8 },
});
