/**
 * BriefHomeCard — the coach Home entry to today's brief (Command Center
 * Overview, above Money). Static on purpose: opening Home never prepares the
 * brief; the brief screen does, once a day.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";
import { radius, typography } from "../../../theme/tokens";
import { CARD_A, SEMI, styleA } from "../../../screens/coach/home-v11/HomeParts";

interface Props {
  onOpen: () => void;
  /** "home": the coach Home's Style A white card (HOME3 A): Inter title, grey line, chevron, no icon. */
  look?: "card" | "home";
}

export default function BriefHomeCard({ onOpen, look = "card" }: Props) {
  const { colors, colorScheme } = useTheme();
  const home = look === "home";
  const light = colorScheme !== "dark";
  const base = useMemo(() => makeStyles(colors), [colors]);
  const hl = useMemo(() => makeHomeStyles(colors, light), [colors, light]);
  const styles = home ? hl : base;
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel="Today's brief"
      accessibilityHint="Opens money, messages and check-ins in one read"
      testID="coach-home-brief-card"
    >
      {home ? null : <Ionicons name="sunny-outline" size={22} color={colors.primary} />}
      <View style={styles.text}>
        <Text style={styles.title}>Today&apos;s brief</Text>
        <Text style={styles.sub}>Money, messages and check-ins in one read.</Text>
      </View>
      <Ionicons name="chevron-forward" size={home ? 20 : 18} color={home && light ? styleA.inkMuted : colors.textSecondary} />
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      // COACH-HOME-134: rounded hairline card (Q10b) with a serif title.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      padding: 20,
      marginBottom: 16,
    },
    text: { flex: 1, gap: 2 },
    title: {
      ...typography.h3,
      color: colors.textPrimary,
    },
    sub: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });

/** HOME3 A's brief card (a.py `setup()`: `.card.setup.row`, `.st`, `.ss`); a dark scheme keeps the theme's surface and text. */
const makeHomeStyles = (colors: ThemeColors, light: boolean) =>
  StyleSheet.create({
    card: {
      ...CARD_A,
      ...(light ? null : { backgroundColor: colors.surface, borderColor: colors.border }),
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingTop: 14,
      paddingHorizontal: 16,
      paddingBottom: 14,
    },
    text: { flex: 1, gap: 2 },
    title: { fontFamily: SEMI, fontSize: 16, lineHeight: 21, color: light ? styleA.ink : colors.textPrimary },
    sub: { fontFamily: "Inter_400Regular", fontSize: 12.5, lineHeight: 17, color: light ? styleA.grey : colors.textSecondary },
  });
