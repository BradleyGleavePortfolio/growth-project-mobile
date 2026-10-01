/**
 * HomeQuickLinks — S-REACH (2026-10-01). Home rows into the coaching surfaces
 * that were registered but had no way in: the meal plan, macro targets,
 * progress, and habits with the daily check-in. Each target reads a live
 * backend route (ops REACHABILITY_MAP.md), so none of these rows is gated.
 *
 * Plan, ClientMacros and Progress live in the More stack; Habits lives in the
 * Home stack. Cross-stack rows go through the tab navigator with
 * `initial: false` so the More stack keeps its own first screen underneath
 * and the back control returns somewhere sensible.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from "@react-navigation/native";
import { typography } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";

export type HomeQuickLink = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Home-stack screen, or a More-stack screen reached through the tab bar. */
  target: { stack: "home"; screen: string } | { stack: "more"; screen: string };
};

export const HOME_QUICK_LINKS: HomeQuickLink[] = [
  {
    key: "plan",
    label: "Meal plan",
    icon: "calendar-outline",
    target: { stack: "more", screen: "Plan" },
  },
  {
    key: "macros",
    label: "Macro targets",
    icon: "nutrition-outline",
    target: { stack: "more", screen: "ClientMacros" },
  },
  {
    key: "progress",
    label: "Progress",
    icon: "trending-up-outline",
    target: { stack: "more", screen: "Progress" },
  },
  {
    key: "habits",
    label: "Habits and check-in",
    icon: "checkmark-circle-outline",
    target: { stack: "home", screen: "Habits" },
  },
];

export default function HomeQuickLinks(): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const open = (link: HomeQuickLink) => {
    if (link.target.stack === "home") {
      navigation.navigate(link.target.screen);
    } else {
      navigation.navigate("MoreTab", {
        screen: link.target.screen,
        initial: false,
      });
    }
  };
  return (
    <View testID="home-quick-links" style={styles.wrap}>
      <Text
        style={[styles.eyebrow, { color: sc.textMuted }]}
        accessibilityRole="header"
      >
        YOUR COACHING
      </Text>
      {HOME_QUICK_LINKS.map((link) => (
        <Pressable
          key={link.key}
          onPress={() => open(link)}
          accessibilityRole="button"
          accessibilityLabel={link.label}
          testID={`home-link-${link.key}`}
          style={({ pressed }) => [
            styles.row,
            { borderColor: sc.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name={link.icon} size={20} color={sc.textPrimary} />
          <Text style={[styles.label, { color: sc.textPrimary }]}>
            {link.label}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 32 },
  eyebrow: { ...typography.eyebrow, marginBottom: 8 },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomWidth: 0.5,
    paddingVertical: 12,
  },
  label: { ...typography.bodyMd, flex: 1 },
});
