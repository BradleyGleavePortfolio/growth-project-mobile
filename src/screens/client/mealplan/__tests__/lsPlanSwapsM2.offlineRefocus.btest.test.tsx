// LS-PLAN-SWAPS-M-2 B1 (B-TEST, fails at 768c578d): the plan meal page forgets its own offline log when it comes back
// into focus. FIX-PSM-1 (13245897) starts a new visit on every focus (PlanMealScreen.tsx:100-105): the footer drops
// LogPlannedMealButton, and with it the button's "Saved offline" state, then decides "eaten" again from the day's log.
// Offline that read fails, so the log in hand decides (PlanMealScreen.tsx:110-113), and the log in hand never holds a
// queued log: LogPlannedMealButton.tsx:122-126 queues offline and refreshes nothing. So "Ate it as planned" comes
// back, and a second tap queues a second log of the same meal (a save after an answered one gets a new key,
// saveKey.ts:44-56). Fictional data (client Jordan, coach Sam).
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import PlanMealScreen from "../PlanMealScreen";

jest.mock("../../../../config/featureFlags", () => {
  const actual = jest.requireActual("../../../../config/featureFlags");
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      foodPlanChecklist: true,
      youTabV2: true,
      clientTimelineV2: true,
      romanChat: true,
    },
  };
});
// The page's focus callbacks are kept, so the test can bring the page back into focus (a tab switch and back).
const mockFocus: Array<() => void> = [];
jest.mock("@react-navigation/native", () => {
  const ReactActual = jest.requireActual("react");
  return {
    useRoute: () => ({ params: { date: "2026-11-24", slotId: "s-din" } }),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      ReactActual.useEffect(() => {
        mockFocus.push(cb);
        cb();
      }, [cb]);
    },
  };
});
const mockGet = jest.fn();
const mockDaily = jest.fn();
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  recipesApi: {
    getById: jest.fn(async () => ({
      data: {
        id: "r1",
        ingredients: ["Salmon fillet 160 g"],
        instructions: [],
        allergens: [],
        allergens_declared: true,
      },
    })),
  },
  listsApi: { bulkAdd: jest.fn() },
  logApi: {
    getDaily: (...a: unknown[]) => mockDaily(...a),
    deleteEntry: jest.fn(),
    logFood: jest.fn(),
  },
  foodApi: { create: jest.fn() },
}));
// The offline write is main's (submitManualLogOffline); only its edge is counted here.
const mockQueue = jest.fn();
jest.mock("../../../../utils/log/logSubmit", () => ({
  ...jest.requireActual("../../../../utils/log/logSubmit"),
  submitManualLogOffline: (...a: unknown[]) => mockQueue(...a),
  submitManualLogOnlineWithId: jest.fn(async () => ({ entryId: "e-online" })),
}));
jest.mock("../../../../services/foodLogSync", () => ({
  ...jest.requireActual("../../../../services/foodLogSync"),
  notifyPendingFoodLogs: jest.fn(async () => 1),
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
}));
jest.useFakeTimers({
  now: new Date("2026-11-24T19:40:00"),
  advanceTimers: true,
  doNotFake: [
    "nextTick",
    "setImmediate",
    "clearImmediate",
    "setInterval",
    "clearInterval",
    "setTimeout",
    "clearTimeout",
    "queueMicrotask",
    "hrtime",
    "performance",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "requestIdleCallback",
    "cancelIdleCallback",
  ],
});
afterAll(() => jest.useRealTimers());

const TODAY = "2026-11-24";
const dinner = {
  id: "m-din",
  coach_id: "sam",
  name: "Salmon, potatoes and green beans",
  description: null,
  calories_kcal: 620,
  protein_g: 42,
  carbs_g: 55,
  fats_g: 22,
  fiber_g: null,
  items: null,
  created_at: "",
  archived_at: null,
};
const plan = {
  date: TODAY,
  changes_today: [],
  assignments: [
    {
      id: "a1",
      daily_meal_plan: {
        id: "p1",
        coach_id: "sam",
        name: "Training day",
        notes: null,
        slots: [
          {
            id: "s-din",
            daily_meal_plan_id: "p1",
            meal_template_id: "m-din",
            slot_label: "dinner",
            order: 0,
            time_of_day: "19:30",
            meal_template: dinner,
            swaps: [],
            recipe_id: "r1",
          },
        ],
      },
    },
  ],
};

const netinfo = NetInfo as unknown as {
  __setState: (s: { isConnected: boolean; isInternetReachable: boolean }) => void;
  __reset: () => void;
};
const networkError = () =>
  Object.assign(new Error("Network Error"), { code: "ERR_NETWORK", isAxiosError: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus.length = 0;
  netinfo.__reset();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/me/meal-plan/today")) return { data: plan };
    if (url === "/v1/clients/me/coach") return { data: { name: "Sam Reid" } };
    throw new Error(`unexpected GET ${url}`);
  });
  // Online at first: Dinner is not eaten yet.
  mockDaily.mockResolvedValue({ data: { entries: [] } });
  mockQueue.mockResolvedValue(dinner.name);
});

// The app's query defaults (src/services/queryClient.ts:48-51), with no retries so the offline read fails at once
// (the app retries it twice, then lands in the same error state).
let client: QueryClient | null = null;
const appClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: 10 * 60_000 },
    },
  });
afterEach(() => {
  client?.clear();
  client = null;
  netinfo.__reset();
});

describe("LS-PLAN-SWAPS-M-2 B1: the page keeps its own offline log when it comes back into focus", () => {
  it('Dinner saved offline on its page, then the Food tab and back: no second "Ate it as planned"', async () => {
    client = appClient();
    await render(
      <QueryClientProvider client={client}>
        <PlanMealScreen />
      </QueryClientProvider>,
    );
    const button = await screen.findByText("Ate it as planned");

    // The connection drops in the kitchen; she taps "Ate it as planned" and the log is queued.
    netinfo.__setState({ isConnected: false, isInternetReachable: false });
    mockDaily.mockRejectedValue(networkError());
    fireEvent.press(button);
    expect(await screen.findByText(/Saved offline/)).toBeTruthy();
    expect(mockQueue).toHaveBeenCalledTimes(1);

    // She taps the Food tab, then the You tab: the page comes back into focus, still offline.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    await act(async () => {
      mockFocus.forEach((cb) => cb());
    });
    // Whatever the page reads on its return (at this head: the day's log, which fails offline) settles first.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(client?.isFetching()).toBe(0));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Dinner is already queued: the page must not offer to log it again.
    expect(screen.queryByText("Ate it as planned")).toBeNull();
    expect(mockQueue).toHaveBeenCalledTimes(1);
  });
});
