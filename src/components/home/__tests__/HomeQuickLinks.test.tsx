/**
 * S-REACH — Home rows into the meal plan, macro targets, progress and habits.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock("../../../theme/ThemeProvider", () => ({
  useTheme: () => ({ semanticColors: new Proxy({}, { get: () => "#000000" }) }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import HomeQuickLinks, { HOME_QUICK_LINKS } from "../HomeQuickLinks";

const SRC = path.join(__dirname, "..", "..", "..");
const NAV = fs.readFileSync(
  path.join(SRC, "navigation", "ClientNavigator.tsx"),
  "utf8",
);

describe("HomeQuickLinks", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens More-stack screens through the tab bar and Habits inside the Home stack", async () => {
    await render(<HomeQuickLinks />);
    await fireEvent.press(screen.getByTestId("home-link-plan"));
    expect(mockNavigate).toHaveBeenCalledWith("MoreTab", {
      screen: "Plan",
      initial: false,
    });
    await fireEvent.press(screen.getByTestId("home-link-macros"));
    expect(mockNavigate).toHaveBeenCalledWith("MoreTab", {
      screen: "ClientMacros",
      initial: false,
    });
    await fireEvent.press(screen.getByTestId("home-link-progress"));
    expect(mockNavigate).toHaveBeenCalledWith("MoreTab", {
      screen: "Progress",
      initial: false,
    });
    await fireEvent.press(screen.getByTestId("home-link-habits"));
    expect(mockNavigate).toHaveBeenCalledWith("Habits");
  });

  it("every row targets a route registered on the right stack, and HomeScreen mounts the rows", () => {
    for (const link of HOME_QUICK_LINKS) {
      const stack =
        link.target.stack === "home" ? "HomeStackNav" : "MoreStackNav";
      expect(NAV).toMatch(
        new RegExp(`<${stack}\\.Screen\\s+name="${link.target.screen}"`),
      );
    }
    const home = fs.readFileSync(
      path.join(SRC, "screens", "client", "HomeScreen.tsx"),
      "utf8",
    );
    expect(home).toMatch(/<HomeQuickLinks \/>/);
  });

  it("copy has no exclamation marks or emoji", () => {
    for (const link of HOME_QUICK_LINKS) {
      expect(link.label).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
  });
});
