/**
 * S-REACH — More entry points. Every coaching row opens a route that is
 * registered for clients, cross-tab rows go through the tab navigator with
 * initial: false, and the live AI "Guidance" row exists only behind
 * featureFlags.aiGuide (default OFF).
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
  aiGuide: false,
  romanChat: false,
  clientTutorial: false,
};
jest.mock("../../../config/featureFlags", () => ({
  featureFlags: new Proxy(
    {},
    { get: (_t, k: string) => mockFlags[k] ?? false },
  ),
}));
jest.mock("../../../theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => "#000000" }),
    semanticColors: new Proxy({}, { get: () => "#000000" }),
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

import MoreScreen, { COACHING_MORE_ITEMS } from "../MoreScreen";

const NAV = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "navigation", "ClientNavigator.tsx"),
  "utf8",
);

/** Route names registered on a given stack navigator object in ClientNavigator. */
function stackRoutes(stackVar: string): string[] {
  const re = new RegExp(`<${stackVar}\\.Screen\\s+name="(\\w+)"`, "g");
  return Array.from(NAV.matchAll(re), (m) => m[1]);
}

describe("More: coaching rows (S-REACH)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags.aiGuide = false;
  });

  it("lists the six coaching surfaces", () => {
    expect(COACHING_MORE_ITEMS.map((i) => i.label)).toEqual([
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
    for (const item of COACHING_MORE_ITEMS) {
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

  it("hides the live AI Guidance row while featureFlags.aiGuide is off", async () => {
    await render(<MoreScreen />);
    expect(screen.queryByLabelText("Guidance")).toBeNull();
  });

  it("shows the Guidance row when featureFlags.aiGuide is on", async () => {
    mockFlags.aiGuide = true;
    await render(<MoreScreen />);
    await fireEvent.press(screen.getByLabelText("Guidance"));
    expect(mockNavigate).toHaveBeenCalledWith("AIGuide");
  });
});
