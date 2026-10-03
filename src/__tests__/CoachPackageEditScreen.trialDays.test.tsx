// src/__tests__/CoachPackageEditScreen.trialDays.test.tsx
//
// B-TRIALS-2 — the coach sets a real free trial on a renewing package
// (backend #656 stores CoachPackage.trial_days, 0..30, renewing plans only).
//   1. Preset chips (None, 3, 7, 14, 30 days) and a typed value reach the
//      PATCH body as trial_days.
//   2. Out of range is refused before saving with the server's rule in words.
//   3. A coded server refusal (PACKAGE_TRIAL_*) shows its specific message,
//      never the generic "Could not save".
//   4. One-time packages show no trial field.
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

// ── Theme mock ──────────────────────────────────────────────────────────────
jest.mock("../theme/ThemeProvider", () => {
  const tokensModule = jest.requireActual("../theme/tokens");
  const realTokens = tokensModule.default;
  const CanonicalColors = jest.requireActual("../constants/colors").default;
  const colors = {
    ...CanonicalColors,
    dark: CanonicalColors.textPrimary,
    white: CanonicalColors.textOnPrimary,
    gold: CanonicalColors.warning,
    orange: CanonicalColors.error,
  };
  return {
    useTheme: () => ({
      colors,
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      tierColors: {
        accentBorder: realTokens.colors.forest,
        accentBg: "rgba(44,74,54,0.06)",
        accentFg: realTokens.colors.forest,
        badgeShadow: realTokens.shadows.sm,
      },
      colorScheme: "light",
    }),
  };
});

jest.mock("expo-font", () => ({ isLoaded: () => true }));
jest.mock("../lib/analytics", () => ({ track: jest.fn() }));
jest.mock("../utils/haptics", () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));
jest.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: "u1", email: "c@x.com", name: "Coach Lee" }),
}));

const mockUpdate = jest.fn();
jest.mock("../api/packagesApi", () => {
  const actual = jest.requireActual("../api/packagesApi");
  return {
    ...actual,
    coachPackagesApi: {
      update: (...a: unknown[]) => mockUpdate(...a),
      create: jest.fn(),
      archive: jest.fn(),
    },
  };
});

import CoachPackageEditScreen from "../screens/coach/payments/CoachPackageEditScreen";
import { toBackendUpdate, type CoachPackage } from "../api/packagesApi";

function pkg(overrides: Partial<CoachPackage> = {}): CoachPackage {
  return {
    id: "pkg_1",
    coachUserId: "u1",
    title: "Strength Builder",
    description: "Get strong.",
    priceCents: 9900,
    currency: "usd",
    billingInterval: "monthly",
    intervalCount: 1,
    trialDays: null,
    features: ["Programming", "Form checks"],
    status: "active",
    shareToken: "tok_123",
    subscriberCount: 0,
    monthlyRevenueCents: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    ...overrides,
  };
}

function makeProps(initialPackage: CoachPackage) {
  return {
    navigation: {
      navigate: jest.fn(),
      goBack: jest.fn(),
      dispatch: jest.fn(),
    } as never,
    route: {
      params: { packageId: initialPackage.id, initialPackage },
    } as never,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

async function mount(initial: CoachPackage) {
  const props = makeProps(initial);
  return render(
    <CoachPackageEditScreen
      navigation={props.navigation}
      route={props.route}
    />,
  );
}

describe("CoachPackageEditScreen — free trial days (B-TRIALS-2)", () => {
  it("a preset chip sets the trial and the save sends trial_days", async () => {
    mockUpdate.mockResolvedValue({ data: pkg({ trialDays: 7 }) });
    const r = await mount(pkg());
    expect(r.getByText("Free trial (optional)")).toBeTruthy();
    expect(r.getByText(/pay nothing until the trial ends/)).toBeTruthy();
    await fireEvent.press(r.getByTestId("trial-preset-7"));
    expect(r.getByTestId("trial-preset-7").props.accessibilityState).toEqual({
      selected: true,
    });
    await fireEvent.press(r.getByLabelText("Save changes"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ trialDays: 7 });
  });

  it("None clears an existing trial (trial_days 0)", async () => {
    mockUpdate.mockResolvedValue({ data: pkg() });
    const r = await mount(pkg({ trialDays: 14 }));
    expect(r.getByDisplayValue("14")).toBeTruthy();
    await fireEvent.press(r.getByTestId("trial-preset-0"));
    await fireEvent.press(r.getByLabelText("Save changes"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ trialDays: 0 });
  });

  it("refuses 31 days before saving, with the 1 to 30 rule in words", async () => {
    const r = await mount(pkg());
    await fireEvent.changeText(r.getByTestId("trial-days-input"), "31");
    await fireEvent.press(r.getByLabelText("Save changes"));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(r.getByText(/from 1 to 30 days/)).toBeTruthy();
  });

  it("a coded server refusal shows its specific message, not the generic one", async () => {
    mockUpdate.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: "PACKAGE_TRIAL_REQUIRES_RECURRING",
          code: "PACKAGE_TRIAL_REQUIRES_RECURRING",
          message:
            "Free trials work on plans that renew. Make this package renew, or set the trial to 0 days.",
        },
      },
    });
    const r = await mount(pkg());
    await fireEvent.press(r.getByTestId("trial-preset-3"));
    await fireEvent.press(r.getByLabelText("Save changes"));
    await waitFor(() => {
      const calls = (Alert.alert as jest.Mock).mock.calls;
      const trial = calls.find((c) => c[0] === "Check the free trial");
      expect(trial).toBeTruthy();
      expect(trial[1]).toMatch(/Make this package renew/);
      expect(calls.find((c) => c[0] === "Could not save")).toBeUndefined();
    });
  });

  it("an edit that leaves the trial alone sends no trial_days (C-338-3)", async () => {
    mockUpdate.mockResolvedValue({
      data: pkg({ trialDays: 7, title: "Renamed" }),
    });
    const r = await mount(pkg({ trialDays: 7 }));
    await fireEvent.changeText(
      r.getByDisplayValue("Strength Builder"),
      "Renamed",
    );
    await fireEvent.press(r.getByLabelText("Save changes"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const sent = mockUpdate.mock.calls[0][1];
    expect(sent).toMatchObject({ title: "Renamed" });
    expect(sent.trialDays).toBeUndefined();
    expect(toBackendUpdate(sent)).not.toHaveProperty("trial_days");
  });

  it("a $0 price with a trial is refused on the device, before any request (C-338-2)", async () => {
    const r = await mount(pkg());
    await fireEvent.changeText(r.getByDisplayValue("99.00"), "0");
    await fireEvent.press(r.getByTestId("trial-preset-7"));
    await fireEvent.press(r.getByLabelText("Save changes"));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(r.getByText(/Price must be greater than zero/)).toBeTruthy();
  });

  it("a one-time package shows no trial field", async () => {
    const r = await mount(pkg({ billingInterval: "one_time" }));
    expect(r.queryByText("Free trial (optional)")).toBeNull();
    expect(r.queryByTestId("trial-days-input")).toBeNull();
  });
});
