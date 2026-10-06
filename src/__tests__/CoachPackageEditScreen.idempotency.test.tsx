// src/__tests__/CoachPackageEditScreen.idempotency.test.tsx
//
// S-COACH-3 (agent 113) — OR-112-16 / B-641-5 follow-up (Opus): the package
// editor's create sends ONE Idempotency-Key per create attempt and re-sends
// it on every retry, so a lost response can never make a second package.
// Before this change every tap generated a fresh key (no dedupe possible).

import AsyncStorage from "@react-native-async-storage/async-storage";
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

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock("../api/packagesApi", () => {
  const actual = jest.requireActual("../api/packagesApi");
  return {
    ...actual,
    coachPackagesApi: {
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      archive: jest.fn(),
    },
  };
});

import CoachPackageEditScreen from "../screens/coach/payments/CoachPackageEditScreen";

const offline = () =>
  Object.assign(new Error("timeout of 30000ms exceeded"), {
    code: "ECONNABORTED",
    request: {},
  });
const httpError = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data, headers: {} },
  });
const created = (id = "pkg_1") => ({
  data: {
    id,
    coachUserId: "u1",
    title: "Strength Builder",
    description: null,
    priceCents: 9900,
    currency: "usd",
    billingInterval: "monthly",
    intervalCount: 1,
    trialDays: null,
    features: [],
    status: "active",
    shareToken: null,
    subscriberCount: 0,
    monthlyRevenueCents: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
  },
});

async function mountCreate() {
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    dispatch: jest.fn(),
  };
  const screen = await render(
    <CoachPackageEditScreen
      navigation={navigation as never}
      route={{ key: "k", name: "CoachPackageEdit", params: {} } as never}
    />,
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText("e.g. 12-week transformation"),
    "Strength Builder",
  );
  await fireEvent.changeText(screen.getByPlaceholderText("199.00"), "99");
  return { ...screen, navigation };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await AsyncStorage.clear();
});

describe("OR-112-16 package editor create is idempotent per attempt", () => {
  it("a retry after a timeout re-sends the same key and body", async () => {
    mockCreate
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce(created());
    const s = await mountCreate();
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "You appear to be offline",
        expect.any(String),
      ),
    );
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(s.navigation.dispatch).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(typeof mockCreate.mock.calls[0][1]).toBe("string");
    expect(mockCreate.mock.calls[1][1]).toBe(mockCreate.mock.calls[0][1]);
    expect(mockCreate.mock.calls[1][0]).toEqual(mockCreate.mock.calls[0][0]);
  });

  it("after a success the next package gets a new key", async () => {
    mockCreate
      .mockResolvedValueOnce(created("pkg_1"))
      .mockResolvedValueOnce(created("pkg_2"));
    const s = await mountCreate();
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    expect(mockCreate.mock.calls[1][1]).not.toBe(mockCreate.mock.calls[0][1]);
  });

  it("a definitive 400 drops the key, so the fixed retry is a new attempt", async () => {
    mockCreate
      .mockRejectedValueOnce(
        httpError(400, {
          code: "PACKAGE_INVALID",
          message: "Name is too long.",
        }),
      )
      .mockResolvedValueOnce(created());
    const s = await mountCreate();
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
    expect(mockCreate.mock.calls[1][1]).not.toBe(mockCreate.mock.calls[0][1]);
  });

  it("422 IDEMPOTENCY_KEY_REUSED adopts the package the key made and saves the new details onto it", async () => {
    mockCreate.mockRejectedValueOnce(
      httpError(422, {
        code: "IDEMPOTENCY_KEY_REUSED",
        package_id: "pkg_first",
        message: "reused",
      }),
    );
    mockUpdate.mockResolvedValueOnce(created("pkg_first"));
    const s = await mountCreate();
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0][0]).toBe("pkg_first");
    await waitFor(() => expect(s.navigation.dispatch).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("an unknown failure shows specific copy, never the old generic line", async () => {
    mockCreate.mockRejectedValueOnce(httpError(500, {}));
    const s = await mountCreate();
    await fireEvent.press(s.getByLabelText("Create package"));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, body] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).not.toBe("Could not save");
    expect(String(body)).not.toMatch(/Please check your inputs/);
  });

  it("B-329-1: the app is killed after a timeout; reopening the editor resumes the same create, once", async () => {
    mockCreate.mockRejectedValueOnce(offline());
    const first = await mountCreate();
    await fireEvent.press(first.getByLabelText("Create package"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const sentKey = mockCreate.mock.calls[0][1];
    const sentBody = mockCreate.mock.calls[0][0];
    await first.unmount();

    mockCreate.mockResolvedValueOnce(created());
    const navigation = {
      navigate: jest.fn(),
      goBack: jest.fn(),
      dispatch: jest.fn(),
    };
    const second = await render(
      <CoachPackageEditScreen
        navigation={navigation as never}
        route={{ key: "k2", name: "CoachPackageEdit", params: {} } as never}
      />,
    );
    await second.findByTestId("package-edit-resumed");
    await fireEvent.press(second.getByLabelText("Create package"));
    await waitFor(() => expect(navigation.dispatch).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][1]).toBe(sentKey);
    expect(mockCreate.mock.calls[1][0]).toEqual(sentBody);
  });
});
