/**
 * FIX ROUND 3 B-332-7 (Opus, B-COACH-5 agent 115): opening Money from the
 * Home card must never strand the Settings tab on Money.
 *
 * Real installed navigators (bottom tabs + native stack), the real
 * CoachHomeCards (its two cards reduced to buttons) and the real MoneyBack.
 * At 6c193c80 the Settings stack was built as ["CoachMoney"] only, so the
 * Settings tab could never show the Settings root (sign out, account
 * deletion) for the rest of the session.
 */
import React from "react";
import { Text, View } from "react-native";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationState,
  type PartialState,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type {
  CoachTabParamList,
  SettingsStackParamList,
} from "../../../../navigation/CoachNavigator";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../../../components/coach/money/MoneyHomeCard", () => {
  const { Text: T, TouchableOpacity: Btn } = jest.requireActual("react-native");
  const R = jest.requireActual("react");
  return {
    __esModule: true,
    default: ({ onOpenMoney }: { onOpenMoney: () => void }) =>
      R.createElement(
        Btn,
        { testID: "home-money-card", onPress: onOpenMoney },
        R.createElement(T, null, "Money card"),
      ),
  };
});
jest.mock("../../../../components/coach/setup/CoachSetupChecklist", () => {
  const {
    Text: T,
    TouchableOpacity: Btn,
    View: V,
  } = jest.requireActual("react-native");
  const R = jest.requireActual("react");
  return {
    __esModule: true,
    default: ({ onOpen }: { onOpen: (t: string) => void }) =>
      R.createElement(
        V,
        null,
        R.createElement(
          Btn,
          { testID: "checklist-package", onPress: () => onOpen("package") },
          R.createElement(T, null, "Package"),
        ),
        R.createElement(
          Btn,
          { testID: "checklist-get-paid", onPress: () => onOpen("get_paid") },
          R.createElement(T, null, "Get paid"),
        ),
      ),
  };
});

import CoachHomeCards from "../../command-center/CoachHomeCards";
import MoneyBack from "../MoneyBack";

const Tab = createBottomTabNavigator<CoachTabParamList>();
const Stack = createNativeStackNavigator<SettingsStackParamList>();
const ref = createNavigationContainerRef<CoachTabParamList>();

const Home = () => (
  <View>
    <Text>Home tab</Text>
    <CoachHomeCards />
  </View>
);
const SettingsRoot = () => <Text>Settings root</Text>;
function Money({
  route,
}: {
  route: { params?: SettingsStackParamList["CoachMoney"] };
}) {
  return (
    <View>
      <MoneyBack toHome={route.params?.from === "home"} />
      <Text>Money page</Text>
    </View>
  );
}
const Plain = () => <Text>Other settings screen</Text>;

function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SettingsHome" component={SettingsRoot} />
      <Stack.Screen name="CoachMoney" component={Money} />
      <Stack.Screen name="CoachPackagesList" component={Plain} />
      <Stack.Screen name="CoachSetup" component={Plain} />
    </Stack.Navigator>
  );
}

async function mount() {
  const r = await render(
    <NavigationContainer ref={ref}>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="CommandCenter" component={Home} />
        <Tab.Screen name="SettingsStack" component={SettingsStack} />
      </Tab.Navigator>
    </NavigationContainer>,
  );
  return r;
}

type AnyState = NavigationState | PartialState<NavigationState> | undefined;
function settingsRoutes(): string[] {
  const root = ref.getRootState() as AnyState;
  const tab = root?.routes.find((x) => x.name === "SettingsStack");
  const st = tab?.state as AnyState;
  return (st?.routes ?? []).map((x) => x.name);
}

describe("B-332-7 the Settings root stays reachable after Home opens Money", () => {
  it("Home -> Money keeps the Settings root below Money, and the Settings tab reaches it", async () => {
    const r = await mount();
    await act(async () => {
      fireEvent.press(r.getByTestId("home-money-card"));
    });
    expect(settingsRoutes()).toEqual(["SettingsHome", "CoachMoney"]);
    expect(ref.getCurrentRoute()?.name).toBe("CoachMoney");

    // Tapping the focused Settings tab pops to its root. The native stack
    // does that on the next animation frame, so wait for it.
    await act(async () => {
      fireEvent.press(r.getByText("SettingsStack"));
    });
    await waitFor(() =>
      expect(ref.getCurrentRoute()?.name).toBe("SettingsHome"),
    );
    expect(settingsRoutes()).toEqual(["SettingsHome"]);
    expect(r.getByText("Settings root")).toBeTruthy();
  });

  it("Back on Money opened from Home returns to Home and leaves the Settings root in place", async () => {
    const r = await mount();
    await act(async () => {
      fireEvent.press(r.getByTestId("home-money-card"));
    });
    await act(async () => {
      fireEvent.press(r.getByLabelText("Back to Home"));
    });
    expect(ref.getCurrentRoute()?.name).toBe("CommandCenter");
    await act(async () => {
      fireEvent.press(r.getByText("SettingsStack"));
    });
    expect(ref.getCurrentRoute()?.name).toBe("SettingsHome");
  });

  it("checklist targets keep the Settings root too", async () => {
    const r = await mount();
    await act(async () => {
      fireEvent.press(r.getByTestId("checklist-package"));
    });
    expect(settingsRoutes()).toEqual(["SettingsHome", "CoachPackagesList"]);
  });
});
