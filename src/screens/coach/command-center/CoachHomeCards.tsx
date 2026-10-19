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
import CoachSetupChecklist from "../../../components/coach/setup/CoachSetupChecklist";
import PushPermissionCard from "../../../components/home/PushPermissionCard";
import { coachLandingTab } from "../../../navigation/coachLanding";
import type { CoachTabParamList } from "../../../navigation/CoachNavigator";
import { useSetupOpener } from "./useSetupOpener";

export default function CoachHomeCards() {
  const navigation =
    useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  const { open, openMoney } = useSetupOpener();
  // Today's brief (SettingsStack > CoachBrief); `initial: false` as in useSetupOpener.
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
      {/* C-S-PUSH-3 + COACHLAND: Overview is the landing (coachTabsV2 on), so
          it carries the coach's deferred push ask, in Home's hairline look. */}
      {coachLandingTab() === "CommandCenter" ? (
        <PushPermissionCard audience="coach" presentation="section" />
      ) : null}
      <CoachSetupChecklist onOpen={open} />
      {featureFlags.coachBrief ? <BriefHomeCard onOpen={openBrief} /> : null}
      <MoneyHomeCard
        onOpenMoney={openMoney}
        onSetUpStripe={() => open("get_paid")}
      />
    </View>
  );
}
