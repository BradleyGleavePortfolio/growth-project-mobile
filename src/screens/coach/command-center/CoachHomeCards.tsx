/**
 * S-COACH — cards on the coach Home (Command Center Overview, below today's clients; COACH-HOME-134):
 * the setup checklist (each item opens the matching wizard step, which stays
 * reachable after setup), today's brief (flag coachBrief) and the Money card,
 * which expands into the Money page.
 */
import React, { useCallback } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import MoneyHomeCard from "../../../components/coach/money/MoneyHomeCard";
import BriefHomeCard from "../../../components/coach/brief/BriefHomeCard";
import { featureFlags } from "../../../config/featureFlags";
import CoachSetupChecklist, {
  type ChecklistTarget,
} from "../../../components/coach/setup/CoachSetupChecklist";
import type { CoachTabParamList } from "../../../navigation/CoachNavigator";

export default function CoachHomeCards() {
  const navigation =
    useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  // B-332-7 (Opus): `initial: false` keeps the Settings root under these
  // screens. Without it a Settings stack that was never opened is built with
  // only the target screen, and the Settings tab can no longer reach sign
  // out or account deletion. Money opened from Home goes back to Home.
  const openMoney = useCallback(
    () =>
      navigation.navigate("SettingsStack", {
        screen: "CoachMoney",
        params: { from: "home" },
        initial: false,
      }),
    [navigation],
  );
  const open = useCallback(
    (target: ChecklistTarget) => {
      switch (target) {
        case "get_paid":
          navigation.navigate("SettingsStack", {
            screen: "CoachSetup",
            params: { section: "get_paid" },
            initial: false,
          });
          return;
        case "invite":
          navigation.navigate("SettingsStack", {
            screen: "CoachSetup",
            params: { section: "invite" },
            initial: false,
          });
          return;
        case "package":
          navigation.navigate("SettingsStack", {
            screen: "CoachPackagesList",
            initial: false,
          });
          return;
        case "money":
          openMoney();
          return;
      }
    },
    [navigation, openMoney],
  );
  // Today's brief (SettingsStack > CoachBrief); `initial: false` as above.
  const openBrief = useCallback(
    () =>
      navigation.navigate("SettingsStack", {
        screen: "CoachBrief",
        initial: false,
      }),
    [navigation],
  );
  return (
    <View testID="coach-home-cards">
      <CoachSetupChecklist onOpen={open} />
      {featureFlags.coachBrief ? <BriefHomeCard onOpen={openBrief} /> : null}
      <MoneyHomeCard
        onOpenMoney={openMoney}
        onSetUpStripe={() => open("get_paid")}
      />
    </View>
  );
}
