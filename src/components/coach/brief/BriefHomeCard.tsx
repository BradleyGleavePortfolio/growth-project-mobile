/**
 * BriefHomeCard — the coach Home entry to today's brief (Command Center
 * Overview, above Money). Static on purpose: opening Home never prepares the
 * brief; the brief screen does, once a day.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeColors } from "../../../theme/ThemeProvider";

interface Props {
  onOpen: () => void;
}

export default function BriefHomeCard({ onOpen }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel="Today's brief"
      accessibilityHint="Opens money, messages and check-ins in one read"
      testID="coach-home-brief-card"
    >
      <Ionicons name="sunny-outline" size={22} color={colors.primary} />
      <View style={styles.text}>
        <Text style={styles.title}>Today&apos;s brief</Text>
        <Text style={styles.sub}>Money, messages and check-ins in one read.</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
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
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 16,
      marginBottom: 16,
    },
    text: { flex: 1, gap: 2 },
    title: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 17,
      color: colors.textPrimary,
    },
    sub: {
      fontFamily: "Inter_400Regular",
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });
