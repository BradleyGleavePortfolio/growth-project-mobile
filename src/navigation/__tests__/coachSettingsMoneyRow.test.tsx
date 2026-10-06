/**
 * FIX ROUND 3 B-332-9 + C-332-12 (Opus, B-COACH-5 agent 115): coach
 * Settings has one Money row, hidden once the server has said the signed-in
 * coach's money is handled by a head coach. Mocks mirror
 * imessageDmRoutes.test.tsx (the existing coach Settings render harness).
 */
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { act } from "@testing-library/react-native";
// Required lazily so the Settings harness loads on a head without it.
const noteHeadCoachHandlesMoney = (v: boolean): void => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require("../../lib/money/headCoachRole") as {
    noteHeadCoachHandlesMoney: (value: boolean) => void;
  };
  m.noteHeadCoachHandlesMoney(v);
};

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest"),
);

jest.mock("../../services/api", () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn(), delete: jest.fn() },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  coachApi: { getClients: jest.fn(async () => ({ data: [] })) },
  notificationsApi: {
    getPreferences: jest.fn(async () => ({ data: {} })),
    updatePreferences: jest.fn(async () => ({ data: {} })),
  },
  usersApi: {
    getAccountStatus: jest.fn(async () => ({ data: { status: "active" } })),
  },
  AccountStatus: {},
}));

jest.mock("../../services/authActions", () => ({
  signOut: jest.fn(async () => undefined),
  refreshProfile: jest.fn(async () => undefined),
}));

jest.mock("../../utils/haptics", () => ({
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

// The booking options row (m#381) reads a query hook; this harness renders Settings without a QueryClient,
// so the row is stubbed exactly as in imessageDmRoutes.test.tsx.
jest.mock("../../screens/coach/settings/BookingOptionsEntry", () => ({
  BookingOptionsEntry: () => null,
}));

jest.mock("../../utils/supabaseAuth", () => ({
  updateSupabasePassword: jest.fn(async () => ({ ok: true })),
}));

jest.mock("../../theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: {
      background: "#000",
      surface: "#111",
      border: "#222",
      primary: "#0af",
      primaryDark: "#08c",
      textPrimary: "#fff",
      textSecondary: "#ccc",
      textMuted: "#888",
      textOnPrimary: "#000",
      error: "#f33",
      success: "#3f3",
    },
    appearanceOverride: "system",
    setAppearanceOverride: jest.fn(),
    tokens: {},
  }),
  ThemeColors: {},
  AppearanceOverride: {},
}));

// M-FEATURED-123: the role decides whether the owner-only Featured coach row shows.
let mockRole: string | undefined;
jest.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: "me", email: "me@example.com", role: mockRole }),
}));

jest.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { notifications_enabled: true },
    updateSetting: jest.fn(),
  }),
}));

jest.mock("../../utils/authEvents", () => ({
  authEvents: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
}));

jest.mock("../../components/BiometricUnlockSetting", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { __esModule: true, default: () => React.createElement(View) };
});

// HUNT-09-124: helpUrl is a function; the help-row case below asserts the path it is called with.
jest.mock("../../config/env", () => ({
  helpUrl: (p?: string) => `https://example.com/help${p ? (p.startsWith("/") ? p : `/${p}`) : ""}`,
}));

// Coach settings sub-components — replace with minimal stubs so the screen
// renders without their internal data dependencies firing.
jest.mock("../../screens/coach/settings/ProfileSection", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { ProfileSection: () => React.createElement(View) };
});
jest.mock("../../screens/coach/settings/SettingsToggles", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { SettingsToggles: () => React.createElement(View) };
});
jest.mock("../../screens/coach/settings/BillingSection", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { BillingSection: () => React.createElement(View) };
});
jest.mock("../../screens/coach/settings/DangerZone", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { DangerZone: () => React.createElement(View) };
});

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  };
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockRole = undefined;
});

describe("coach Settings Money row", () => {
  it("exactly one row opens Money", async () => {
    noteHeadCoachHandlesMoney(false);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CoachSettings = require("../../screens/coach/SettingsScreen").default;
    const r = await render(<CoachSettings />);
    expect(r.getAllByTestId("settings-money")).toHaveLength(1);
    await fireEvent.press(r.getByTestId("settings-money"));
    expect(mockNavigate).toHaveBeenCalledWith("CoachMoney");
  });

  it("the Business section no longer has a second Money row (C-332-12)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("path") as typeof import("path");
    const billing = fs.readFileSync(
      path.join(__dirname, "../../screens/coach/settings/BillingSection.tsx"),
      "utf8",
    );
    expect(billing).not.toMatch(/onOpenMoney|Money and business numbers/);
  });

  it("an active sub-coach does not see a Money row", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CoachSettings = require("../../screens/coach/SettingsScreen").default;
    const r = await render(<CoachSettings />);
    expect(r.queryByTestId("settings-money")).not.toBeNull();
    await act(async () => {
      noteHeadCoachHandlesMoney(true);
    });
    expect(r.queryByTestId("settings-money")).toBeNull();
    noteHeadCoachHandlesMoney(false);
  });
});

describe("coach Settings Featured coach row (M-FEATURED-123)", () => {
  it("the owner sees one row, and it opens the editor", async () => {
    mockRole = "owner";
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CoachSettings = require("../../screens/coach/SettingsScreen").default;
    const r = await render(<CoachSettings />);
    expect(r.getAllByTestId("settings-featured-coach")).toHaveLength(1);
    await fireEvent.press(r.getByTestId("settings-featured-coach"));
    expect(mockNavigate).toHaveBeenCalledWith("ClientsStack", { screen: "FeaturedCoachEditor" });
  });

  it.each(["coach", "sub_coach"])("a %s account never sees it", async (role) => {
    mockRole = role;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CoachSettings = require("../../screens/coach/SettingsScreen").default;
    const r = await render(<CoachSettings />);
    expect(r.queryByTestId("settings-featured-coach")).toBeNull();
  });
});

describe("coach Settings Help centre row (HUNT-09-124)", () => {
  it("opens the help centre home, not the missing /help/coach page", async () => {
    const canOpen = jest.spyOn(Linking, "canOpenURL").mockResolvedValue(true);
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CoachSettings = require("../../screens/coach/SettingsScreen").default;
    const r = await render(<CoachSettings />);
    await fireEvent.press(r.getByLabelText("Open help centre"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://example.com/help"));
    expect(open).not.toHaveBeenCalledWith("https://example.com/help/coach");
    canOpen.mockRestore();
    open.mockRestore();
  });
});
