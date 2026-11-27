// LS-PLAN-SWAPS-M-1 B2 (B-TEST, fails at b14e1008): the Food tab opens the plan meal page with navigate('MoreTab',
// { screen: 'PlanMeal', params, initial: false }) (LogScreen.tsx:799). When the You stack is still showing a plan meal
// page (she went back to Food with the tab bar), React Navigation 7's StackRouter reuses that route with the new params
// (@react-navigation/routers StackRouter NAVIGATE: "If the route matches the current one, then navigate to it"), so the
// same PlanMealScreen instance shows the second meal. Its "eaten" decision (PlanMealScreen.tsx:88-89) and the
// LogPlannedMealButton under it keep the first meal's state: Lunch, already eaten, offers "Ate it as planned" again
// (one tap logs it twice), and after logging Dinner there, Lunch's page keeps Dinner's Undo. Fictional data (Jordan, Sam).
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
let mockParams: { date: string; slotId: string } = {
  date: "2026-11-24",
  slotId: "s-din",
};
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
const mockGet = jest.fn();
const mockDaily = jest.fn();
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  recipesApi: { getById: jest.fn() },
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
  now: new Date("2026-11-24T15:10:00"),
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
const tpl = (id: string, name: string, kcal: number) => ({
  id,
  coach_id: "sam",
  name,
  description: null,
  calories_kcal: kcal,
  protein_g: 40,
  carbs_g: 60,
  fats_g: 20,
  fiber_g: null,
  items: null,
  created_at: "",
  archived_at: null,
});
const lunch = tpl("m-lun", "Chicken, rice and greens", 680);
const dinner = tpl("m-din", "Salmon, potatoes and green beans", 620);
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
            id: "s-lun",
            daily_meal_plan_id: "p1",
            meal_template_id: "m-lun",
            slot_label: "lunch",
            order: 0,
            time_of_day: "12:30",
            meal_template: lunch,
            swaps: [],
            recipe_id: null,
          },
          {
            id: "s-din",
            daily_meal_plan_id: "p1",
            meal_template_id: "m-din",
            slot_label: "dinner",
            order: 0,
            time_of_day: "19:30",
            meal_template: dinner,
            swaps: [],
            recipe_id: null,
          },
        ],
      },
    },
  ],
};
// Today's log: Lunch eaten as planned; Dinner still to eat.
const log = {
  entries: [
    {
      id: "e1",
      meal_type: "lunch",
      plan_slot_id: "s-lun",
      quantity_multiplier: 1,
      original_quantity: 1,
      original_unit: "serving",
      food_item: {
        name: lunch.name,
        calories: 680,
        protein_g: 40,
        carbs_g: 60,
        fat_g: 20,
        nutrient_basis: "PER_SERVING",
      },
      calories: 680,
      protein_g: 40,
      carbs_g: 60,
      fat_g: 20,
    },
  ],
};

let client: QueryClient | null = null;
afterEach(() => {
  client?.clear();
  client = null;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { date: TODAY, slotId: "s-din" };
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/me/meal-plan/today")) return { data: plan };
    if (url === "/v1/clients/me/coach") return { data: { name: "Sam Reid" } };
    throw new Error(`unexpected GET ${url}`);
  });
  mockDaily.mockResolvedValue({ data: log });
});

describe("LS-PLAN-SWAPS-M-1 B2: the page opened again for another meal answers for that meal", () => {
  it('Dinner\'s page, then the Food tab opens Lunch\'s on the same route: Lunch reads "Logged as planned", never "Ate it as planned"', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client as QueryClient}>
        <PlanMealScreen />
      </QueryClientProvider>
    );
    const view = await render(tree());
    expect(await screen.findByText(dinner.name)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("Ate it as planned")).toBeTruthy(),
    );
    // The Food tab's door with the You stack still on Dinner's page: same route, new params.
    mockParams = { date: TODAY, slotId: "s-lun" };
    await view.rerender(tree());
    expect(await screen.findByText(lunch.name)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("plan-meal-status")).toHaveTextContent(
        "Logged as planned",
      ),
    );
    expect(screen.queryByText("Ate it as planned")).toBeNull();
  });
});
