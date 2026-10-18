/**
 * S-COACH-MOB-2 — Back row for the Money screens (the Settings stack hides
 * the native header, matching CoachSetupScreen).
 *
 * B-332-7 (Opus): Money opened from the Home card sits in the Settings tab
 * above the Settings root. `toHome` pops it and returns to the Home tab, so
 * Back leads where the coach came from and the Settings root stays below.
 */
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { CoachTabParamList } from "../../../navigation/CoachNavigator";
import { useTheme } from "../../../theme/ThemeProvider";
import { featureFlags } from "../../../config/featureFlags";

export default function MoneyBack({
  testID,
  toHome = false,
}: {
  testID?: string;
  toHome?: boolean;
}) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  if (!navigation.canGoBack()) return null;
  // COACHTABS: with the six tabs Money is the Money tab's root: no Back there.
  if (featureFlags.coachTabsV2 && navigation.getState()?.index === 0) return null;
  const onPress = () => {
    navigation.goBack();
    if (toHome) {
      navigation
        .getParent<BottomTabNavigationProp<CoachTabParamList>>()
        ?.navigate("CommandCenter");
    }
  };
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        alignSelf: "flex-start",
      }}
      accessibilityRole="button"
      accessibilityLabel={toHome ? "Back to Home" : "Go back"}
      testID={testID ?? "money-back"}
    >
      <Text
        style={{
          fontFamily: "Inter_600SemiBold",
          fontSize: 15,
          color: colors.primary,
        }}
      >
        Back
      </Text>
    </TouchableOpacity>
  );
}
