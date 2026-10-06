/**
 * S-COACH-MOB-2 — the retired Earnings and Business metrics routes land
 * here and are replaced by TGP Money, so every old entry point (Settings,
 * Team profile, deep links, notifications) opens the live Money page and
 * nothing reachable calls the six routes that never shipped.
 */
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../../../theme/ThemeProvider";
import type { SettingsStackParamList } from "../../../navigation/CoachNavigator";

export default function MoneyRedirect() {
  const { colors } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<SettingsStackParamList>>();
  useEffect(() => {
    navigation.replace("CoachMoney");
  }, [navigation]);
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.background,
      }}
      testID="money-redirect"
    >
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel="Opening Money"
      />
    </View>
  );
}
