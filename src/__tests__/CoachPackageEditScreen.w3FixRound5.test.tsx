// FIX ROUND 5 (B-WIZ5-122): Sol B-347-4. "Make <name> live" publishes the
// stored row, so it must not run while the editor shows unsaved terms.
import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("../theme/ThemeProvider", () => {
  const tokens = jest.requireActual("../theme/tokens").default;
  return {
    useTheme: () => ({
      tokens,
      semanticColors: tokens.lightTokens,
      colors: jest.requireActual("../constants/colors").default,
    }),
  };
});
jest.mock("expo-font", () => ({ isLoaded: () => true }));
jest.mock("../lib/analytics", () => ({ track: jest.fn() }));
jest.mock("../utils/haptics", () => ({
  mediumTap: jest.fn(),
  successTap: jest.fn(),
  warningTap: jest.fn(),
}));
jest.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: "coach_w5", name: "Coach Lee" }),
}));

const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("../services/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: (...a: unknown[]) => mockPost(...a),
    patch: (...a: unknown[]) => mockPatch(...a),
  },
}));

import CoachPackageEditScreen from "../screens/coach/payments/CoachPackageEditScreen";
import type { CoachPackage } from "../api/packagesApi";

const T = "2026-10-01T12:00:00Z";
const draft: CoachPackage = {
  id: "pkg_w5", coachUserId: "coach_w5", title: "Coaching", description: "Weekly coaching",
  priceCents: 9900, currency: "usd", billingInterval: "monthly", intervalCount: 1, trialDays: null,
  features: [], status: "active", shareToken: null, subscriberCount: 0, monthlyRevenueCents: 0,
  createdAt: T, updatedAt: T, archivedAt: null, publishedAt: null,
};
let server: Record<string, unknown>;
let soldCents: unknown;
const alerts = () => (Alert.alert as jest.Mock).mock.calls.map((c) => c[0]);
const open = () =>
  render(
    <CoachPackageEditScreen
      navigation={{ navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() } as never}
      route={{ key: "w5", name: "CoachPackageEdit", params: { packageId: draft.id, initialPackage: draft } } as never}
    />,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await AsyncStorage.clear();
  soldCents = null;
  server = {
    id: "pkg_w5", name: "Coaching", description: "Weekly coaching", amount_cents: 9900, currency: "usd",
    billing_type: "recurring", billing_interval: "month", billing_interval_count: 1, is_active: true,
    published_at: null,
  };
  mockPatch.mockImplementation(async (_u: string, body: Record<string, unknown>) => {
    server = { ...server, ...body };
    return { data: { ...server } };
  });
  // The backend publishes the stored row; it never takes terms from the device.
  mockPost.mockImplementation(async (url: string) => {
    if (url !== "/v1/coach/packages/pkg_w5/publish") throw new Error(`unexpected POST ${url}`);
    server = { ...server, published_at: T };
    soldCents = server.amount_cents;
    return { data: { ...server } };
  });
});

describe("B-347-4 Make live with unsaved terms", () => {
  it("does not publish the older $99 offer while the editor shows $199", async () => {
    const s = await open();
    expect(s.queryByTestId("package-edit-publish-unsaved")).toBeNull();
    await fireEvent.changeText(s.getByPlaceholderText("199.00"), "199");
    expect(s.getByText("Save your changes before making this live.")).toBeTruthy();
    // Main refresh (B-WIZ6-122): one publish-waits-for-save path with S-FEE
    // B-321-5: the button is disabled and the line under it says why.
    const makeLive = s.getByLabelText("Make Coaching live");
    expect(makeLive.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(makeLive);
    expect(alerts()).not.toContain("Package is live");
    expect(mockPost).not.toHaveBeenCalled();
    expect(soldCents).toBeNull();
    expect(s.getByText(/Coaching is saved as a draft/)).toBeTruthy();
  });

  it("after Save changes, Make live publishes the saved $199 offer", async () => {
    const s = await open();
    await fireEvent.changeText(s.getByPlaceholderText("199.00"), "199");
    await fireEvent.press(s.getByLabelText("Save changes"));
    await waitFor(() => expect(alerts()).toContain("Package updated"));
    expect(s.queryByTestId("package-edit-publish-unsaved")).toBeNull();
    await fireEvent.press(s.getByLabelText("Make Coaching live"));
    await waitFor(() => expect(alerts()).toContain("Package is live"));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(soldCents).toBe(19900);
  });

  it("an untouched draft still goes live in one tap", async () => {
    const s = await open();
    await fireEvent.press(s.getByLabelText("Make Coaching live"));
    await waitFor(() => expect(alerts()).toContain("Package is live"));
    expect(soldCents).toBe(9900);
  });
});
