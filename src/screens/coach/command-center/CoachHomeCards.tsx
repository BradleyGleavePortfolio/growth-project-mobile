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
import PushPermissionCard from "../../../components/home/PushPermissionCard";
import { coachLandingTab } from "../../../navigation/coachLanding";
import CoachSetupChecklist, {
  type ChecklistTarget,
} from "../../../components/coach/setup/CoachSetupChecklist";
import type { CoachTabParamList } from "../../../navigation/CoachNavigator";

/**
 * `part` (spec #688 6295886580, the new Home): 'setup' is the checklist alone, for the Home's hero; 'below'
 * is the push ask and today's brief, under it (the Home's Business glance stands for the Money card). Both parts draw
 * the Home's Style A white cards (HOME3 A, FR-863R5); 'all' (the old Overview) keeps the hairline looks.
 */
export type CoachHomeCardsPart = "all" | "setup" | "below";

export default function CoachHomeCards({ part = "all", brief = true }: { part?: CoachHomeCardsPart; brief?: boolean } = {}) {
  const navigation =
    useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  // B-332-7 (Opus): `initial: false` keeps the Settings root under these
  // screens. Without it a Settings stack that was never opened is built with
  // only the target screen, and the Settings tab can no longer reach sign
  // out or account deletion. Money opened from Home goes back to Home.
  // COACHTABS: with the six tabs Money is a tab; the card switches to its root.
  const openMoney = useCallback(
    () =>
      featureFlags.coachTabsV2
        ? navigation.navigate("MoneyStack", { screen: "CoachMoney", pop: true })
        : navigation.navigate("SettingsStack", {
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
  if (part === "setup") {
    return <CoachSetupChecklist onOpen={open} look="home" />;
  }
  if (part === "below") {
    const push = coachLandingTab() === "CommandCenter";
    const showBrief = featureFlags.coachBrief && brief;
    if (!push && !showBrief) return null;
    return (
      <View testID="coach-home-cards-below" style={{ gap: 10 }}>
        {push ? <PushPermissionCard audience="coach" presentation="home" /> : null}
        {showBrief ? <BriefHomeCard onOpen={openBrief} look="home" /> : null}
      </View>
    );
  }
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
