/**
 * S-MWB — small shared building blocks for the Programs screens: the failure
 * box (specific message, retry, support path, reference), chips and buttons.
 * Touch targets are at least 44pt and every control has an accessible label
 * (WCAG 2.2 AA: 2.5.8 target size, 4.1.2 name/role/value).
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../../../theme/ThemeProvider";
import type { ProgramFailure } from "../../../utils/programErrors";
import type { ProgramsNav } from "./types";

export function FailureBox({
  failure,
  onRetry,
  retryLabel = "Retry",
}: {
  failure: ProgramFailure;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { colors } = useTheme();
  const navigation = useNavigation<ProgramsNav>();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.failure,
        {
          backgroundColor: colors.noticeCriticalBg,
          borderColor: colors.noticeCriticalAccent,
        },
      ]}
    >
      <Ionicons
        name="alert-circle"
        size={20}
        color={colors.noticeCriticalText}
      />
      <View style={styles.failureBody}>
        <Text
          style={[styles.failureText, { color: colors.noticeCriticalText }]}
        >
          {failure.message}
        </Text>
        <View style={styles.failureActions}>
          {onRetry ? (
            <SmallButton
              label={retryLabel}
              onPress={onRetry}
              accessibilityHint="Runs the action again"
            />
          ) : null}
          {failure.support ? (
            <SmallButton
              label="Contact support"
              onPress={() => navigation.navigate("SupportInbox")}
              accessibilityHint={
                failure.reference
                  ? `Opens support chat. Quote reference ${failure.reference}`
                  : "Opens support chat"
              }
            />
          ) : null}
        </View>
      </View>
    </View>
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

export function LoadingRow({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.loading} accessibilityLabel={label} accessible>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.textSecondary }}>{label}</Text>
    </View>
  );
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
  failure: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 8,
  },
  failureBody: { flex: 1, gap: 8 },
  failureText: { fontSize: 14, lineHeight: 20 },
  failureActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  loading: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16 },
  section: { fontSize: 17, fontWeight: "600", marginTop: 16, marginBottom: 8 },
});
