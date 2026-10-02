/**
 * S-COACH — cards at the top of the coach Home (Command Center Overview):
 * the setup checklist (each item opens the matching wizard step, which stays
 * reachable after setup) and the Money card, which expands into the Money
 * page.
 */
import React, { useCallback } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import MoneyHomeCard from "../../../components/coach/money/MoneyHomeCard";
import CoachSetupChecklist, {
  type ChecklistTarget,
} from "../../../components/coach/setup/CoachSetupChecklist";
import type { CoachTabParamList } from "../../../navigation/CoachNavigator";

export default function CoachHomeCards() {
  const navigation =
    useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  const open = useCallback(
    (target: ChecklistTarget) => {
      switch (target) {
        case "get_paid":
          navigation.navigate("SettingsStack", {
            screen: "CoachSetup",
            params: { section: "get_paid" },
          });
          return;
        case "invite":
          navigation.navigate("SettingsStack", {
            screen: "CoachSetup",
            params: { section: "invite" },
          });
          return;
        case "package":
          navigation.navigate("SettingsStack", { screen: "CoachPackagesList" });
          return;
        case "money":
          navigation.navigate("SettingsStack", { screen: "CoachMoney" });
          return;
      }
    },
    [navigation],
  );
  return (
    <View testID="coach-home-cards">
      <CoachSetupChecklist onOpen={open} />
      <MoneyHomeCard
        onOpenMoney={() =>
          navigation.navigate("SettingsStack", { screen: "CoachMoney" })
        }
        onSetUpStripe={() => open("get_paid")}
      />
    </View>
  );
}
