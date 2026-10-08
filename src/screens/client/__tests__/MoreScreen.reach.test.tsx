/**
 * S-REACH: More entry points. Every "your plan" row opens a route that is
 * registered for clients, cross-tab rows go through the tab navigator with
 * initial: false (so Back works), and the existing rows are unchanged.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    getParent: () => ({ navigate: mockParentNavigate }),
  }),
}));
const mockFlags: Record<string, boolean> = {
  romanChat: false,
  clientTutorial: false,
};
let mockSemanticColors: import("../../../theme/tokens").SemanticTokens = require("../../../theme/tokens").lightTokens;
jest.mock("../../../config/featureFlags", () => ({
  featureFlags: new Proxy(
    {},
    { get: (_t, k: string) => mockFlags[k] ?? false },
  ),
}));
let mockHealthConnectBuild = false;
jest.mock("../../../config/healthConnect", () => ({
  isAndroidHealthConnectEnabled: () => mockHealthConnectBuild,
}));
jest.mock("../../../theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => "#000000" }),
    semanticColors: mockSemanticColors,
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../../components/roman/RomanAvatar", () => () => null);
jest.mock(
  "../../../components/tutorial/TutorialTarget",
  () =>
    ({ children }: { children: React.ReactNode }) =>
      children,
);
jest.mock("../../../components/HapticPressable", () => {
  const { Pressable } = jest.requireActual("react-native");
  return Pressable;
});

import { Platform, StyleSheet } from "react-native";
import MoreScreen, { PLAN_MORE_ITEMS } from "../MoreScreen";
import { darkTokens, lightTokens } from "../../../theme/tokens";

const NAV = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "navigation", "ClientNavigator.tsx"),
  "utf8",
);

/** Route names registered on a given stack navigator object in ClientNavigator. */
function stackRoutes(stackVar: string): string[] {
  const re = new RegExp(`<${stackVar}\\.Screen\\s+name="(\\w+)"`, "g");
  return Array.from(NAV.matchAll(re), (m) => m[1]);
}

describe("More: your plan rows (S-REACH)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags.romanChat = false;
  });

  it("lists the six plan surfaces", () => {
    expect(PLAN_MORE_ITEMS.map((i) => i.label)).toEqual([
      "Meal plan",
      "Macro targets",
      "Progress",
      "Habits and check-in",
      "Timeline",
      "Exercise library",
    ]);
  });

  it("every row targets a route registered on the matching client stack", () => {
    const more = stackRoutes("MoreStackNav");
    const byTab: Record<string, string[]> = {
      Home: stackRoutes("HomeStackNav"),
      WorkoutTab: stackRoutes("WorkoutStackNav"),
    };
    for (const item of PLAN_MORE_ITEMS) {
      if (item.target.type === "stack")
        expect(more).toContain(item.target.screen);
      else expect(byTab[item.target.tab]).toContain(item.target.screen);
    }
  });

  it("stack rows push inside More; cross-tab rows go through the tab bar and keep the stack root", async () => {
    await render(<MoreScreen />);
    await fireEvent.press(screen.getByLabelText("Meal plan"));
    expect(mockNavigate).toHaveBeenCalledWith("Plan");
    await fireEvent.press(screen.getByLabelText("Macro targets"));
    expect(mockNavigate).toHaveBeenCalledWith("ClientMacros");
    await fireEvent.press(screen.getByLabelText("Progress"));
    expect(mockNavigate).toHaveBeenCalledWith("Progress");
    await fireEvent.press(screen.getByLabelText("Timeline"));
    expect(mockNavigate).toHaveBeenCalledWith("Timeline");
    await fireEvent.press(screen.getByLabelText("Habits and check-in"));
    expect(mockParentNavigate).toHaveBeenCalledWith("Home", {
      screen: "Habits",
      initial: false,
    });
    await fireEvent.press(screen.getByLabelText("Exercise library"));
    expect(mockParentNavigate).toHaveBeenCalledWith("WorkoutTab", {
      screen: "ExerciseLibrary",
      initial: false,
    });
  });

  it("keeps every existing row, after the plan rows", async () => {
    await render(<MoreScreen />);
    for (const label of ["Guidance", "Membership", "Recipes", "Settings"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    const labels = screen.getAllByRole("button").map((b) => b.props.accessibilityLabel);
    expect(labels.indexOf("Meal plan")).toBeLessThan(labels.indexOf("Membership"));
  });

  it("puts Roman first when the Roman chat flag is on", async () => {
    mockFlags.romanChat = true;
    await render(<MoreScreen />);
    const labels = screen.getAllByRole("button").map((b) => b.props.accessibilityLabel);
    expect(labels[0]).toBe("Roman");
    expect(labels.slice(0, 3)).toEqual(["Roman", "Guidance", "Community"]);
  });
});

// AUDIT-11-125: the wearables rows were tied to the clinic tutorial flag, which
// the iOS store build leaves off, so an iPhone client had no way to reach Apple Health.
describe("More: Health and sleep / Connected devices (AUDIT-11-125)", () => {
  const originalOS = Platform.OS;
  function setOS(os: string) {
    Object.defineProperty(Platform, "OS", { configurable: true, value: os });
  }
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags.romanChat = true;
    mockFlags.clientTutorial = false;
    mockHealthConnectBuild = false;
  });
  afterEach(() => {
    setOS(originalOS);
    mockFlags.romanChat = false;
    mockFlags.clientTutorial = false;
  });

  function labels(): string[] {
    return screen.getAllByRole("button").map((b) => b.props.accessibilityLabel);
  }

  it("iPhone store build (tutorial off): both rows show after the plan rows and open their screens", async () => {
    setOS("ios");
    await render(<MoreScreen />);
    const l = labels();
    expect(l[0]).toBe("Roman");
    expect(l.indexOf("Health and sleep")).toBeGreaterThan(l.indexOf("Exercise library"));
    expect(l.indexOf("Connected devices")).toBe(l.indexOf("Health and sleep") + 1);
    await fireEvent.press(screen.getByLabelText("Connected devices"));
    expect(mockNavigate).toHaveBeenCalledWith("Connections");
    await fireEvent.press(screen.getByLabelText("Health and sleep"));
    expect(mockNavigate).toHaveBeenCalledWith("Health");
  });

  it("Android build without Health Connect (tutorial off): no wearables rows", async () => {
    setOS("android");
    await render(<MoreScreen />);
    expect(screen.queryByLabelText("Connected devices")).toBeNull();
    expect(screen.queryByLabelText("Health and sleep")).toBeNull();
  });

  it("Android build with Health Connect: both rows show", async () => {
    setOS("android");
    mockHealthConnectBuild = true;
    await render(<MoreScreen />);
    expect(screen.getByLabelText("Connected devices")).toBeTruthy();
    expect(screen.getByLabelText("Health and sleep")).toBeTruthy();
  });

  it("clinic tutorial on: the rows stay first, as before", async () => {
    setOS("android");
    mockFlags.clientTutorial = true;
    await render(<MoreScreen />);
    expect(labels().slice(0, 3)).toEqual(["Health and sleep", "Connected devices", "Roman"]);
  });
});

describe("More: calm groups and complete route parity (DES-AJ-127)", () => {
  const originalOS = Platform.OS;
  const stackRows = [
    ["Meal plan", "Plan"], ["Macro targets", "ClientMacros"], ["Progress", "Progress"],
    ["Timeline", "Timeline"], ["Guidance", "AIGuide"], ["Membership", "Membership"],
    ["Recipes", "Recipes"], ["Fasting", "Fast"], ["Community", "Community"],
    ["Profile", "ProfileMain"], ["Settings", "Settings"], ["Report", "Report"],
    ["Learn", "Learn"], ["Shortcuts", "Widgets"], ["Grocery list", "GroceryList"],
    ["Prep guide", "PrepGuide"],
  ];
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
    mockSemanticColors = lightTokens;
  });

  it.each([
    ["android", false, false, false], ["android", true, false, false],
    ["android", false, false, true], ["android", true, false, true],
    ["android", false, true, false], ["android", true, true, false],
    ["ios", false, false, false], ["ios", true, false, false],
  ])("preserves all actions: %s Roman=%s tutorial=%s health=%s", async (os, roman, tutorial, health) => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, "OS", { configurable: true, value: os });
    mockFlags.romanChat = Boolean(roman);
    mockFlags.clientTutorial = Boolean(tutorial);
    mockHealthConnectBuild = Boolean(health);
    await render(<MoreScreen />);
    const wearableRows = tutorial || health || os === "ios"
      ? [["Health and sleep", "Health"], ["Connected devices", "Connections"]] : [];
    const rows = [...stackRows, ...wearableRows, ...(roman ? [["Roman", "RomanChat"]] : [])];
    expect(screen.getAllByRole("button")).toHaveLength(rows.length + 2);
    for (const [label, route] of rows) {
      expect(stackRoutes("MoreStackNav")).toContain(route);
      await fireEvent.press(screen.getByLabelText(label));
      expect(mockNavigate).toHaveBeenLastCalledWith(route);
    }
    for (const [label, tab, route] of [
      ["Habits and check-in", "Home", "Habits"],
      ["Exercise library", "WorkoutTab", "ExerciseLibrary"],
    ]) {
      await fireEvent.press(screen.getByLabelText(label));
      expect(mockParentNavigate).toHaveBeenLastCalledWith(tab, { screen: route, initial: false });
    }
    expect(screen.queryByLabelText("Roman") !== null).toBe(Boolean(roman));
    expect(screen.queryByLabelText("Connected devices") !== null).toBe(wearableRows.length > 0);
    expect(screen.getAllByRole("header").map((h) => h.props.children)).toEqual([
      "More", ...(tutorial ? ["Health and devices"] : []),
      ...(roman ? ["Guidance and community"] : []), "Your plan",
      ...(!tutorial && wearableRows.length ? ["Health and devices"] : []),
      ...(!roman ? ["Guidance and community"] : []), "Food and preparation", "Account", "Learning",
    ]);
    const healthLabels = wearableRows.map(([label]) => label);
    const guidanceLabels = [...(roman ? ["Roman"] : []), "Guidance", "Community"];
    expect(screen.getAllByRole("button").map((b) => b.props.accessibilityLabel)).toEqual([
      ...(tutorial ? healthLabels : []), ...(roman ? guidanceLabels : []),
      "Meal plan", "Macro targets", "Progress", "Habits and check-in", "Timeline",
      "Exercise library", "Membership", "Report", ...(!tutorial ? healthLabels : []),
      ...(!roman ? guidanceLabels : []), "Recipes", "Fasting", "Grocery list",
      "Prep guide", "Profile", "Settings", "Shortcuts", "Learn",
    ]);
  });

  it("one list: Grocery list stays and no row opens the retired Shopping list (CF-ONE-LIST-128)", async () => {
    jest.clearAllMocks();
    await render(<MoreScreen />);
    expect(screen.queryByLabelText("Shopping list")).toBeNull();
    expect(screen.queryByText(/shopping list/i)).toBeNull();
    await fireEvent.press(screen.getByLabelText("Grocery list"));
    expect(mockNavigate).toHaveBeenLastCalledWith("GroceryList");
    expect(mockNavigate).not.toHaveBeenCalledWith("ShoppingList");
  });

  it("does not assume a coach, assigned plan, targets or video", async () => {
    await render(<MoreScreen />);
    for (const copy of ["View meal plans", "View daily calorie and nutrient targets",
      "Browse exercise instructions", "Open AI guidance", "View timeline entries",
      "Membership and access details", "Quick log and start a fast", "View meal preparation guidance",
      "View weight trends and daily totals"]) {
      expect(screen.getByText(copy)).toBeTruthy();
    }
    expect(screen.getByLabelText("Guidance").props.accessibilityHint).toBe("Opens AI guidance");
  });

  it.each([lightTokens, darkTokens])("uses semantic colors and comfortable unboxed rows", async (palette) => {
    mockSemanticColors = palette;
    await render(<MoreScreen />);
    expect(screen.getByText("More")).toHaveStyle({ fontFamily: "CormorantGaramond_400Regular", color: palette.textPrimary });
    expect(screen.getByText("Your plan")).toHaveStyle({ fontFamily: "Inter_500Medium", color: palette.textMuted });
    expect(screen.getByText("Meal plan")).toHaveStyle({ fontFamily: "Inter_500Medium", fontSize: 16 });
    expect(screen.getByLabelText("Meal plan")).toHaveStyle({ minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border });
    expect(screen.getByLabelText("Meal plan")).not.toHaveStyle({ backgroundColor: palette.bgSurface });
  });
});
