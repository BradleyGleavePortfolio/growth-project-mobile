// FIX ROUND 4 (B-WIZ4-122): Sol's W3 full-review Bs on the package editor.
//   B-347-1 the free first package saves a name change at its unchanged $0.
//   B-347-2 no trial input while trial_days never reaches the server; the
//           buyer preview shows only the trial the saved package carries.
//   B-347-3 a draft made in the editor has a reachable "Make ... live" action
//           (the wizard's publish route); the server row decides the state.
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
  useCurrentUser: () => ({ id: "coach_w4", name: "Coach Lee" }),
}));
jest.mock("../screens/client/packageDetail/PackageDetailSurface", () => {
  const R = require("react");
  const { Text } = require("react-native");
  return ({ package: pkg }: { package: { trialDays: number | null } }) =>
    R.createElement(Text, { testID: "w4-preview-trial" }, String(pkg.trialDays));
});

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
const row = (o: Partial<CoachPackage> = {}): CoachPackage => ({
  id: "pkg_w4", coachUserId: "coach_w4", title: "Coaching", description: "Weekly coaching",
  priceCents: 9900, currency: "usd", billingInterval: "monthly", intervalCount: 1, trialDays: null,
  features: [], status: "active", shareToken: null, subscriberCount: 0, monthlyRevenueCents: 0,
  createdAt: T, updatedAt: T, archivedAt: null, publishedAt: T, ...o,
});
const serverRow = (o: Record<string, unknown> = {}) => ({
  id: "pkg_w4", name: "Coaching", description: "Weekly coaching", amount_cents: 9900, currency: "usd",
  billing_type: "recurring", billing_interval: "month", billing_interval_count: 1, is_active: true,
  published_at: T, ...o,
});
const nav = () => ({ navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() });
const edit = (pkg: CoachPackage) =>
  ({ key: "w4", name: "CoachPackageEdit", params: { packageId: pkg.id, initialPackage: pkg } }) as never;
const alerts = () => (Alert.alert as jest.Mock).mock.calls.map((c) => c[0]);

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await AsyncStorage.clear();
});

describe("B-347-1 free first package", () => {
  it("saves a new name at the unchanged $0 one-time price", async () => {
    mockPatch.mockResolvedValue({
      data: serverRow({ name: "Free intro", amount_cents: 0, billing_type: "one_time", billing_interval: null }),
    });
    const free = row({ priceCents: 0, billingInterval: "one_time" });
    const s = await render(<CoachPackageEditScreen navigation={nav() as never} route={edit(free)} />);
    await fireEvent.changeText(s.getByPlaceholderText("e.g. 12-week transformation"), "Free intro");
    await fireEvent.press(s.getByLabelText("Save changes"));
    await waitFor(() => expect(alerts()).toContain("Package updated"));
    expect(mockPatch).toHaveBeenCalledTimes(1);
    // Main refresh (B-WIZ6-122): S-FEE B-321-3 sends billing only when the
    // coach changed it, so a name edit keeps the stored one-time billing.
    expect(mockPatch.mock.calls[0][1]).toEqual(
      expect.objectContaining({ name: "Free intro", amount_cents: 0 }),
    );
    expect(mockPatch.mock.calls[0][1].billing_type).toBeUndefined();
  });
});

describe("B-347-2 trial terms", () => {
  it("offers no trial input and previews only the saved trial", async () => {
    const s = await render(<CoachPackageEditScreen navigation={nav() as never} route={edit(row())} />);
    expect(s.queryByText(/Trial days/i)).toBeNull();
    expect(s.queryByPlaceholderText("0")).toBeNull();
    await fireEvent.press(s.getByLabelText("Preview as buyer"));
    expect(s.getByTestId("w4-preview-trial").props.children).toBe("null");
  });
});

describe("B-347-3 draft made in the editor", () => {
  it("creates a draft, then makes it live with the wizard's publish route", async () => {
    mockPost.mockImplementation(async (url: string) =>
      url === "/v1/coach/packages/pkg_w4/publish"
        ? { data: serverRow() }
        : { data: serverRow({ published_at: null }) },
    );
    const n = nav();
    const s = await render(
      <CoachPackageEditScreen
        navigation={n as never}
        route={{ key: "w4c", name: "CoachPackageEdit", params: { packageId: null } } as never}
      />,
    );
    await fireEvent.changeText(s.getByPlaceholderText("e.g. 12-week transformation"), "Coaching");
    await fireEvent.changeText(s.getByPlaceholderText("199.00"), "99");
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(n.dispatch).toHaveBeenCalledTimes(1));
    const created = n.dispatch.mock.calls[0][0].payload.params.initialPackage;
    expect(created.publishedAt).toBeNull();
    await s.rerender(<CoachPackageEditScreen navigation={n as never} route={edit(created)} />);
    expect(s.getByText(/Coaching is saved as a draft/)).toBeTruthy();
    await fireEvent.press(s.getByLabelText("Make Coaching live"));
    await waitFor(() => expect(alerts()).toContain("Package is live"));
    // S-FEE round 4: the one publish call carries an Idempotency-Key.
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/coach/packages/pkg_w4/publish",
      {},
      expect.objectContaining({ headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }) }),
    );
    expect(s.queryByLabelText("Make Coaching live")).toBeNull();
  });

  it("keeps the draft and the action when publishing fails", async () => {
    mockPost.mockRejectedValue(
      Object.assign(new Error("x"), { response: { status: 400, data: { code: "PACKAGE_INVALID" } } }),
    );
    const s = await render(
      <CoachPackageEditScreen navigation={nav() as never} route={edit(row({ publishedAt: null }))} />,
    );
    await fireEvent.press(s.getByLabelText("Make Coaching live"));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(alerts()).not.toContain("Package is live");
    expect(s.getByLabelText("Make Coaching live")).toBeTruthy();
  });
});
