/**
 * S-COACH — cards at the top of the coach Home (Command Center Overview):
 * the setup checklist. Each item opens the matching wizard step, which stays
 * reachable after setup.
 */
import React, { useCallback } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import CoachSetupChecklist, {
  type ChecklistTarget,
} from "../../../components/coach/setup/CoachSetupChecklist";
import type { CoachTabParamList } from "../../../navigation/CoachNavigator";

export default function CoachHomeCards() {
  const navigation =
    useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  const open = useCallback(
    (target: ChecklistTarget, done: boolean | null) => {
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
          // A first payment needs a client on a package: before it lands,
          // open the invite step; after, the packages list shows who pays.
          // (Never the retired Earnings screen.)
          if (done === true) {
            navigation.navigate("SettingsStack", {
              screen: "CoachPackagesList",
            });
          } else {
            navigation.navigate("SettingsStack", {
              screen: "CoachSetup",
              params: { section: "invite" },
            });
          }
          return;
      }
    },
    [navigation],
  );
  return (
    <View testID="coach-home-cards">
      <CoachSetupChecklist onOpen={open} />
    </View>
  );
}
