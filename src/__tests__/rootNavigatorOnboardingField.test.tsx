/**
 * Day-1 onboarding correctness (operator 14:00): the backend sends the
 * profile flag as `onboardingCompleted` (UserProfile.onboardingCompleted,
 * returned as stored by GET /auth/me and GET /profile). A student who has
 * finished onboarding and signs in on a fresh install (no local flags) must
 * go to the app, not through onboarding again. Before this fix the app read
 * only `profile.onboarding_completed`, which the server never sends.
 */
/**
 * Fix round #304 (Sol B1), caller level: RootNavigator's 24h package-prompt
 * re-surface uses the real packagePromptGate and is offered only after an
 * explicit inactive entitlement. Comp (active) and every unknown/error
 * lookup must land the client in the app with no prompt. Harness mirrors
 * rootNavigatorPersistedCacheGate.test.tsx (real RootNavigator, mocked
 * native/network edges).
 */
const mockSecure: Record<string, string | null> = {};
jest.mock("../services/secureStorage", () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockSecure[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockSecure[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete mockSecure[k];
    }),
  },
}));
jest.mock("../services/authActions", () => ({
  signOut: jest.fn(async () => {}),
}));
jest.mock("../services/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { is_complete: true } })),
    post: jest.fn(async () => ({ data: {} })),
  },
}));
jest.mock("react-native/Libraries/Linking/Linking", () => ({
  __esModule: true,
  default: {
    getInitialURL: jest.fn(async () => null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    openURL: jest.fn(async () => true),
  },
}));
jest.mock("@react-navigation/native", () => {
  const React = jest.requireActual("react");
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
      resetRoot: jest.fn(),
      // S-DUNNING: the payment-lockout provider reads the focused route.
      getCurrentRoute: () => undefined,
      addListener: () => () => undefined,
      current: null,
    }),
  };
});
// S-DUNNING: the lockout provider's status read is not under test here.
jest.mock("../entitlements/dunning/dunningApi", () => ({
  ...jest.requireActual("../entitlements/dunning/dunningApi"),
  dunningApi: {
    getStatus: jest.fn(async () => ({ enabled: false, state: "none" })),
    createCardSetup: jest.fn(),
    confirmCardUpdate: jest.fn(),
    cancelPlan: jest.fn(),
  },
}));
jest.mock("../navigation/AuthNavigator", () => {
  const React = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return () => React.createElement(Text, { testID: "nav-auth" }, "auth");
});
jest.mock("../navigation/CoachNavigator", () => {
  const React = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  const { queryClient } = jest.requireActual("../services/queryClient");
  // The private surface reports what it can see from the cache at mount.
  return () => {
    const me = queryClient.getQueryData(["me"]);
    return React.createElement(
      Text,
      { testID: "nav-coach" },
      me ? JSON.stringify(me) : "none",
    );
  };
});
jest.mock("../navigation/ClientNavigator", () => {
  const React = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return () => React.createElement(Text, { testID: "nav-client" }, "client");
});
jest.mock("../navigation/OnboardingNavigator", () => {
  const { Text } = jest.requireActual("react-native");
  const R = jest.requireActual("react");
  return () =>
    R.createElement(Text, { testID: "nav-onboarding" }, "onboarding");
});
jest.mock("../navigation/LeanOnboardingNavigator", () => {
  const { Text } = jest.requireActual("react-native");
  const R = jest.requireActual("react");
  return () =>
    R.createElement(Text, { testID: "nav-onboarding" }, "onboarding");
});
jest.mock("../navigation/CoachWizardNavigator", () => () => null);
jest.mock("../navigation/Day1OnboardingNavigator", () => () => null);
jest.mock("../components/OfflineBanner", () => () => null);
jest.mock("../components/PackageSelectionSheet", () => {
  const React = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return () =>
    React.createElement(Text, { testID: "package-prompt" }, "prompt");
});
const mockGetEntitlement = jest.fn();
jest.mock("../api/clientPaymentsApi", () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
jest.mock("../screens/client/Day1WinScreen", () => () => null);
jest.mock("../services/support/crisp.service", () => ({
  initCrisp: jest.fn(),
  syncCrispIdentity: jest.fn(),
}));
jest.mock("../hooks/useLeanOnboardingReconcile", () => ({
  useLeanOnboardingReconcile: jest.fn(),
}));
jest.mock("../services/firstWinApi", () => ({
  firstWinApi: {
    getStatus: jest.fn().mockResolvedValue({ data: { completed: true } }),
  },
  WinType: {},
}));
jest.mock("../services/foodLogQueue", () => ({
  flush: jest.fn().mockResolvedValue(undefined),
}));
const mockNetwork = { isOnline: true, isInternetReachable: true };
jest.mock("../hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => mockNetwork,
  isEffectivelyOnline: (status: typeof mockNetwork) => status.isOnline && status.isInternetReachable,
}));
jest.mock("../screens/day-one/api", () => ({
  saveGoals: jest.fn(async () => undefined),
  saveNotifPermission: jest.fn(async () => undefined),
  saveCheckInTime: jest.fn(async () => undefined),
  completeDayOne: jest.fn(async () => undefined),
}));
jest.mock("../utils/authEvents", () => ({
  authEvents: {
    onAuthChange: jest.fn(() => () => {}),
    on: jest.fn(() => () => {}),
    emit: jest.fn(),
  },
}));
jest.mock("../screenshots", () => ({ isScreenshotMode: () => false }));
jest.mock("../offline", () => ({
  triggerSync: jest.fn(async () => undefined),
}));
jest.mock("../entitlements/EntitlementProvider", () => ({
  EntitlementProvider: ({ children }: { children: unknown }) => children,
}));

let mockHidden = false;
jest.mock("../config/purchaseSurfaces", () => ({
  ...jest.requireActual("../config/purchaseSurfaces"),
  nonP2PPurchasesHidden: () => mockHidden,
}));
import React from "react";
import { render, cleanup, act, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClientProvider } from "@tanstack/react-query";
import RootNavigator from "../navigation/RootNavigator";
import { queryClient } from "../services/queryClient";
import { enqueuePending, readResumeState, writeResumeState } from "../screens/day-one/resume";
import { completeDayOne, saveCheckInTime, saveGoals } from "../screens/day-one/api";

import {
  BACKEND_ONBOARDING_FIELD,
  profileOnboardingCompleted,
} from "../lib/profileOnboarding";

// Shape of GET /auth/me `profile` as the backend returns it (Prisma row).
const BACKEND_PROFILE = {
  user_id: "client-S",
  onboardingCompleted: true,
  activity_level: "moderate",
  goal_type: "lose_fat",
};

async function freshInstall(profile: Record<string, unknown>) {
  await AsyncStorage.clear();
  queryClient.clear();
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  mockGetEntitlement.mockReset();
  mockGetEntitlement.mockResolvedValue({
    ok: true,
    data: { active: true, entitlement_active: true },
  });
  mockHidden = false;
  mockSecure["supabase_token"] = "jwt-S";
  await AsyncStorage.setItem(
    "prefs:auth.user_data",
    JSON.stringify({
      id: "client-S",
      email: "s@example.com",
      role: "student",
      name: "Sam",
      profile,
    }),
  );
  await AsyncStorage.setItem(
    "prefs:onboarding.package_prompt_dismissed_at:client-S",
    new Date().toISOString(),
  );
}

afterEach(async () => {
  await cleanup();
});

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <RootNavigator />
    </QueryClientProvider>,
  );

describe("profile onboarding flag uses the backend field name", () => {
  it("pins the backend field name", () => {
    expect(BACKEND_ONBOARDING_FIELD).toBe("onboardingCompleted");
    expect(Object.keys(BACKEND_PROFILE)).toContain(BACKEND_ONBOARDING_FIELD);
  });

  it("reads onboardingCompleted, still accepts the older key, and is false otherwise", () => {
    expect(profileOnboardingCompleted(BACKEND_PROFILE)).toBe(true);
    expect(profileOnboardingCompleted({ onboarding_completed: true })).toBe(
      true,
    );
    expect(profileOnboardingCompleted({ onboardingCompleted: false })).toBe(
      false,
    );
    expect(profileOnboardingCompleted({ onboardingCompleted: null })).toBe(
      false,
    );
    expect(profileOnboardingCompleted({})).toBe(false);
    expect(profileOnboardingCompleted(null)).toBe(false);
    expect(profileOnboardingCompleted(undefined)).toBe(false);
  });

  it("a student who finished onboarding goes to the app on a fresh install, and the local flag is restored", async () => {
    await freshInstall(BACKEND_PROFILE);
    const r = await mount();
    await r.findByTestId("nav-client");
    expect(r.queryByTestId("nav-onboarding")).toBeNull();
    expect(await AsyncStorage.getItem("onboarding_complete")).toBe("true");
  });

  it("a student who has not finished onboarding still goes through it", async () => {
    await freshInstall({ ...BACKEND_PROFILE, onboardingCompleted: false });
    const r = await mount();
    await r.findByTestId("nav-onboarding");
    expect(r.queryByTestId("nav-client")).toBeNull();
  });
});

// B-391-1 (M-FEATURED-123): an owner session lands in the coach app, where
// Settings > Owner > Featured coach lives, and never in the coach wizard.
describe("owner account routing", () => {
  it("a signed-in owner opens the coach app, not sign-in, without the coach onboarding check", async () => {
    await freshInstall(BACKEND_PROFILE);
    await AsyncStorage.setItem(
      "prefs:auth.user_data",
      JSON.stringify({ id: "owner-1", email: "owner@example.com", role: "owner", name: "Owner" }),
    );
    const apiGet = jest.requireMock("../services/api").default.get as jest.Mock;
    apiGet.mockClear();
    const r = await mount();
    await r.findByTestId("nav-coach");
    expect(r.queryByTestId("nav-auth")).toBeNull();
    expect(apiGet.mock.calls.some(([url]) => url === "/coach/onboarding")).toBe(false);
  });
});

describe("HUNT-08 B-08-4: completed offline onboarding rejoins server state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNetwork.isOnline = true;
    mockNetwork.isInternetReachable = true;
  });

  afterEach(() => {
    mockNetwork.isOnline = true;
    mockNetwork.isInternetReachable = true;
    jest.restoreAllMocks();
  });

  async function completedOffline() {
    await freshInstall({ ...BACKEND_PROFILE, day_one_completed: false });
    await AsyncStorage.setItem("day_one_completed", "true");
    await writeResumeState({ step: "Ready", draft: { goals: ["fitness"] } });
    await enqueuePending({ kind: "goals", goals: ["fitness"] });
    await enqueuePending({ kind: "checkin", time: { hour: 8, minute: 0 }, timezone: "America/Los_Angeles" });
    await enqueuePending({ kind: "complete" });
  }

  async function expectSaved() {
    await waitFor(() => expect(completeDayOne).toHaveBeenCalledTimes(1));
    expect(saveGoals).toHaveBeenCalledWith(["fitness"]);
    expect(saveCheckInTime).toHaveBeenCalledWith({ hour: 8, minute: 0 }, "America/Los_Angeles");
    expect(await readResumeState()).toBeNull();
  }

  it("saves queued goals and check-in after an online cold start, without reopening Ready", async () => {
    await completedOffline();
    const r = mount();
    await r.findByTestId("nav-client");
    await expectSaved();
  });

  it("keeps the queue offline and saves it when connectivity returns", async () => {
    await completedOffline();
    mockNetwork.isOnline = false;
    mockNetwork.isInternetReachable = false;
    const r = mount();
    await r.findByTestId("nav-client");
    expect(completeDayOne).not.toHaveBeenCalled();
    expect((await readResumeState())?.pendingSync).toHaveLength(3);
    mockNetwork.isOnline = true;
    mockNetwork.isInternetReachable = true;
    r.rerender(<QueryClientProvider client={queryClient}><RootNavigator /></QueryClientProvider>);
    await expectSaved();
  });

  it("retries the saved queue when a backgrounded app becomes active", async () => {
    await freshInstall({ ...BACKEND_PROFILE, day_one_completed: true });
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      listeners.push(listener as (state: string) => void);
      return { remove: jest.fn() };
    });
    const r = mount();
    await r.findByTestId("nav-client");
    await writeResumeState({ step: "Ready", pendingSync: [{ kind: "goals", goals: ["fitness"] }, { kind: "complete" }] });
    await act(async () => listeners.forEach((listener) => listener("active")));
    await waitFor(() => expect(completeDayOne).toHaveBeenCalledTimes(1));
    expect(saveGoals).toHaveBeenCalledWith(["fitness"]);
    expect(await readResumeState()).toBeNull();
  });

  it("never submits a saved queue while signed out", async () => {
    await completedOffline();
    delete mockSecure["supabase_token"];
    const r = mount();
    await r.findByTestId("nav-auth");
    expect(completeDayOne).not.toHaveBeenCalled();
    expect(saveGoals).not.toHaveBeenCalled();
    expect((await readResumeState())?.pendingSync).toHaveLength(3);
  });
});
