/**
 * PK-2 (owner 2026-10-12): the AI pool on the Money page (bar + numbers) with "Buy more credits" right under it,
 * two taps from Home. Real navigators, Home cards, Money card, Money page and budget query; network, Home checklist
 * and brief, and the purchase gate are stubbed. Unlisted routes answer 404 (each Money section fails on its own).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationState,
  type PartialState,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CoachTabParamList,
  SettingsStackParamList,
} from "../../../../navigation/CoachNavigator";
import type { CoachAIBudgetResponse } from "../../../../api/types/coachAIBudget";
import { lightTokens } from "../../../../theme/tokens";

const mockGet = jest.fn();
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() },
}));
jest.mock("../../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../../../hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock("../../../../components/coach/setup/CoachSetupChecklist", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../../../components/coach/brief/BriefHomeCard", () => ({
  __esModule: true,
  default: () => null,
}));
const mockHaptics: Record<string, jest.Mock> = {
  mediumImpact: jest.fn(),
  softImpact: jest.fn(),
};
jest.mock("../../../../ui/haptics/haptics.service", () => ({
  HapticService: new Proxy({}, { get: (_t, k: string) => mockHaptics[k] ?? jest.fn() }),
}));
let mockPacksHidden = false;
jest.mock("../../../../config/purchaseSurfaces", () => ({
  ...jest.requireActual("../../../../config/purchaseSurfaces"),
  creditPacksHidden: () => mockPacksHidden,
}));

import CoachHomeCards from "../../command-center/CoachHomeCards";
import MoneyScreen from "../MoneyScreen";
import MoneyAIPool from "../MoneyAIPool";

const BUDGET: CoachAIBudgetResponse = {
  period_start: "2026-10-01T00:00:00Z", period_end: "2026-11-01T00:00:00Z",
  base_displayed_cents: 12500, pack_displayed_cents: 0, total_displayed_cents: 12500,
  used_displayed_cents: 4200, remaining_displayed_cents: 8300, pct_used: 33.6,
  base_actual_cents: 4000, value_multiplier: "3.125", actual_used_cents: 1344,
  pack_options_cents: [1000, 2500, 9900], custom_pack_bounds_cents: { min: 1000, max: 50000 },
};

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
const Checkout = () => <Text>Credit packs</Text>;
function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SettingsHome" component={SettingsRoot} />
      <Stack.Screen name="CoachMoney" component={MoneyScreen} />
      <Stack.Screen name="CreditPackCheckout" component={Checkout} />
    </Stack.Navigator>
  );
}

let client: QueryClient;
async function mountApp() {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer ref={ref}>
        <Tab.Navigator screenOptions={{ headerShown: false }}>
          <Tab.Screen name="CommandCenter" component={Home} />
          <Tab.Screen name="SettingsStack" component={SettingsStack} />
        </Tab.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}
async function openMoneyFromHome() {
  const r = await mountApp();
  const card = await r.findByTestId("money-home-card-open");
  await act(async () => {
    fireEvent.press(card); // tap 1
  });
  expect(ref.getCurrentRoute()?.name).toBe("CoachMoney");
  await r.findByTestId("money-ai-pool-amount");
  return r;
}

type AnyState = NavigationState | PartialState<NavigationState> | undefined;
function settingsRoutes(): string[] {
  const root = ref.getRootState() as AnyState;
  const tab = root?.routes.find((x) => x.name === "SettingsStack");
  return ((tab?.state as AnyState)?.routes ?? []).map((x) => x.name);
}

const httpError = (status: number, data: unknown = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: {} } });
let routes: Record<string, unknown> = {};
beforeEach(() => {
  mockPacksHidden = false;
  routes = { "/coach/ai/budget": BUDGET };
  jest.clearAllMocks();
  mockGet.mockImplementation(async (url: string) => {
    if (routes[url] instanceof Error) throw routes[url];
    if (routes[url]) return { data: routes[url] };
    throw httpError(404);
  });
});
afterEach(() => client?.clear());

describe("PK-2 Money page: AI pool with Buy more credits", () => {
  it("two taps from Home: Money card, then Buy more credits opens the credit packs", async () => {
    const r = await openMoneyFromHome();
    expect(mockGet).toHaveBeenCalledWith("/coach/ai/budget");
    expect(r.getByTestId("money-ai-pool-amount").props.children).toBe("$42 / $125");
    expect(r.getByText(/^AI Usage:/)).toBeTruthy();
    expect(r.getByTestId("money-ai-pool-fill")).toHaveStyle({ width: "33.6%" });
    expect(r.getByLabelText("AI Usage: $42 / $125").props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 34,
    });

    await act(async () => {
      fireEvent.press(r.getByText("Buy more credits")); // tap 2
    });
    expect(ref.getCurrentRoute()?.name).toBe("CreditPackCheckout");
    // PK-1 Option 1: no pack is preselected; the coach picks it there.
    expect(ref.getCurrentRoute()?.params).toBeUndefined();
    expect(settingsRoutes()).toEqual(["SettingsHome", "CoachMoney", "CreditPackCheckout"]);
    expect(mockHaptics.mediumImpact).toHaveBeenCalledTimes(1);
    expect(mockHaptics.softImpact).not.toHaveBeenCalled();
  });

  it("where packs are not sold, the pool shows alone: no button, no buy wording", async () => {
    mockPacksHidden = true;
    const r = await openMoneyFromHome();
    const pool = within(r.getByTestId("money-ai-pool"));
    expect(pool.getByTestId("money-ai-pool-fill")).toBeTruthy();
    expect(r.queryByTestId("money-buy-credits")).toBeNull();
    expect(pool.queryByText(/buy|credit|pack/i)).toBeNull();
  });

  it("before Stripe is set up the page keeps one filled button: buying is the quiet text action", async () => {
    routes["/coach/connect/status"] = { account_id: null, state: "not_started" };
    const r = await openMoneyFromHome();
    await r.findByTestId("money-setup-open");
    const filled = within(r.getByTestId("money-screen"))
      .getAllByRole("button")
      .filter((b) => StyleSheet.flatten(b.props.style)?.backgroundColor === lightTokens.accent);
    expect(filled.map((b) => b.props.testID)).toEqual(["money-setup-open"]);
    await act(async () => {
      fireEvent.press(r.getByTestId("money-buy-credits"));
    });
    expect(ref.getCurrentRoute()?.name).toBe("CreditPackCheckout");
    expect(mockHaptics.softImpact).toHaveBeenCalledTimes(1);
    expect(mockHaptics.mediumImpact).not.toHaveBeenCalled();
  });

  it("a sub-coach whose head coach handles money keeps the pool and Buy more credits under the notice", async () => {
    routes["/v1/coach/money/summary"] = httpError(403, { kind: "sub_coach_billing_blocked", message: "blocked" });
    const r = await mountApp();
    await r.findByText("Home tab");
    await act(async () => ref.navigate("SettingsStack", { screen: "CoachMoney" }));
    await r.findByTestId("money-head-coach");
    expect((await r.findByTestId("money-ai-pool-amount")).props.children).toBe("$42 / $125");
    await act(async () => {
      fireEvent.press(r.getByText("Buy more credits"));
    });
    expect(ref.getCurrentRoute()?.name).toBe("CreditPackCheckout");
  });
});

describe("MoneyAIPool states", () => {
  const query = (over: Record<string, unknown>) =>
    ({
      data: undefined,
      error: null,
      isFetching: false,
      refetch: jest.fn(async () => undefined),
      ...over,
    }) as unknown as React.ComponentProps<typeof MoneyAIPool>["query"];

  it("loading uses QuietLoading and keeps the button", async () => {
    const r = await render(<MoneyAIPool query={query({ isFetching: true })} onBuy={jest.fn()} />);
    expect(r.getByTestId("money-ai-pool-loading")).toBeTruthy();
    expect(r.getByLabelText("AI credits, loading")).toBeTruthy();
    expect(r.queryByTestId("money-ai-pool-amount")).toBeNull();
    expect(r.getByTestId("money-buy-credits")).toBeTruthy();
  });

  it("a failed read uses QuietError, and Try again reads the budget again", async () => {
    const q = query({ error: Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }) });
    const onBuy = jest.fn();
    const r = await render(<MoneyAIPool query={q} onBuy={onBuy} />);
    expect(r.getByText("The balance did not load. Tap to try again.")).toBeTruthy();
    await fireEvent.press(r.getByTestId("money-ai-pool-error-retry"));
    expect(q.refetch).toHaveBeenCalledTimes(1);
    await fireEvent.press(r.getByTestId("money-buy-credits"));
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it("use past the pool fills the bar to 100 percent, never beyond", async () => {
    const data = { ...BUDGET, used_displayed_cents: 13000, pct_used: 104 };
    const r = await render(<MoneyAIPool query={query({ data })} />);
    expect(r.getByTestId("money-ai-pool-amount").props.children).toBe("$130 / $125");
    expect(r.getByTestId("money-ai-pool-fill")).toHaveStyle({ width: "100%" });
    expect(r.queryByTestId("money-buy-credits")).toBeNull();
  });

  it("an account the budget route refuses (403) shows no pool and nothing to buy", async () => {
    const r = await render(<MoneyAIPool query={query({ error: httpError(403) })} onBuy={jest.fn()} />);
    expect(r.queryByTestId("money-ai-pool")).toBeNull();
  });
});
