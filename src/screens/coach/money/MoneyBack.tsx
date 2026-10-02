/**
 * S-COACH-MOB-2 — Back row for the Money screens (the Settings stack hides
 * the native header, matching CoachSetupScreen).
 */
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../../../theme/ThemeProvider";

export default function MoneyBack({ testID }: { testID?: string }) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  if (!navigation.canGoBack()) return null;
  return (
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      style={{
        minHeight: 44,
        justifyContent: "center",
        alignSelf: "flex-start",
      }}
      accessibilityRole="button"
      accessibilityLabel="Go back"
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
