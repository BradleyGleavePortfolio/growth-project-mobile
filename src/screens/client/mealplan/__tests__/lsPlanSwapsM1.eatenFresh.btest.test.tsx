// LS-PLAN-SWAPS-M-1 B1 (B-TEST, fails at b14e1008): the plan meal page decides "eaten" from the day's log the
// first time it has one (PlanMealScreen.tsx:83-89, eatenAtOpen) and never looks again. The Food day's own logs
// refresh only the day store (LogScreen logPlanned and the add sheet: refreshShownDay), never the ['food', 'log',
// date] query, and the app keeps that query 30 s fresh and 10 min cached (src/services/queryClient.ts:48-51). So a
// client who looked at her meal plan (ClientDailyMealPlanScreen reads ['food', 'log', today]), then logged Dinner on
// the Food day, then tapped Dinner's "Recipe and grocery list" sees "Ate it as planned" again (S8 says the status
// line takes its place), and one tap logs Dinner twice. Fictional data (client Jordan, coach Sam).
import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: { date: "2026-11-24", slotId: "s-din" } }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
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
// What the server holds now: Dinner logged as planned on the Food day a minute ago.
const eatenNow = {
  entries: [
    {
      id: "e1",
      meal_type: "dinner",
      plan_slot_id: "s-din",
      quantity_multiplier: 1,
      original_quantity: 1,
      original_unit: "serving",
      food_item: {
        name: dinner.name,
        calories: 620,
        protein_g: 42,
        carbs_g: 55,
        fat_g: 22,
        nutrient_basis: "PER_SERVING",
      },
      calories: 620,
      protein_g: 42,
      carbs_g: 55,
      fat_g: 22,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/me/meal-plan/today")) return { data: plan };
    if (url === "/v1/clients/me/coach") return { data: { name: "Sam Reid" } };
    throw new Error(`unexpected GET ${url}`);
  });
  mockDaily.mockResolvedValue({ data: eatenNow });
});

// The app's own query defaults (src/services/queryClient.ts:48-51); each client is cleared after its test so no
// gc timer outlives the run.
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
});

describe("LS-PLAN-SWAPS-M-1 B1: the page reads whether the meal is eaten from a day log read after it opens", () => {
  it.each([
    [
      "read 10 s ago by the meal plan page (still fresh by the app's 30 s)",
      10_000,
    ],
    [
      "read 2 minutes ago by the meal plan page (stale, refetched on open)",
      120_000,
    ],
  ])(
    'Dinner logged on the Food day after the day log was %s: the status line, never "Ate it as planned"',
    async (_, age) => {
      client = appClient();
      // The meal plan page read today's log before she logged Dinner on the Food day (LogScreen refreshes only its store).
      client.setQueryData(
        ["food", "log", TODAY],
        { entries: [] },
        { updatedAt: Date.now() - (age as number) },
      );
      await render(
        <QueryClientProvider client={client}>
          <PlanMealScreen />
        </QueryClientProvider>,
      );
      expect(await screen.findByText(dinner.name)).toBeTruthy();
      await waitFor(() =>
        expect(screen.getByTestId("plan-meal-status")).toHaveTextContent(
          "Logged as planned",
        ),
      );
      expect(screen.queryByText("Ate it as planned")).toBeNull();
    },
  );
});
