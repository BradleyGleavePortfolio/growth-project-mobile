/**
 * SWEEP-MEAL-PLANS B1 (B-TEST, fails at 50ff9b2e): removing one meal from a day plan must not move the meals it keeps.
 *
 * Backend main's PATCH coach/daily-meal-plans/:id (real-meal-plans.service.ts updatePlan, FOODLINK) keys each slot by
 * `${slot_label}#${order}`: a slot whose key is still listed keeps its row and so the client's foods logged for it
 * (LoggedFoodEntry.plan_slot_id). Every other row is deleted (plan_slot_id goes null, onDelete: SetNull) and created
 * again under a new id. The phone's checklist (foodDay.ts buildPlanDay) ticks a plan meal only by that id.
 *
 * MealPickerScreen.write sends `order` as the slot's place in the list, so "Remove breakfast" on
 * [breakfast#0, lunch#1, dinner#2] sends [lunch#0, dinner#1]: no key is kept, lunch and dinner get new rows, and a
 * lunch she already ticked "Ate it as planned" shows as still to eat (her food drops to the extras) on that day and on
 * every earlier day, with "Ate it as planned" offered again.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

type Row = Record<string, any>;
const mockSent: Row[] = [];
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn() };
const mockMeal = (id: string, name: string) =>
  ({ id, coach_id: 'coach', name, description: null, calories_kcal: 500, protein_g: 30, carbs_g: 50, fats_g: 15, fiber_g: null, items: null, created_at: '2026-11-01T00:00:00.000Z', archived_at: null });
const mockMeals = [mockMeal('m1', 'Overnight oats'), mockMeal('m2', 'Chicken rice bowl'), mockMeal('m3', 'Salmon and greens')];
let mockSlots: Row[] = [];
const mockPlan = () => ({ id: 'p1', coach_id: 'coach', name: 'Training day', notes: null, created_at: '2026-11-01T00:00:00.000Z', archived_at: null,
  slots: mockSlots.map((s) => ({ ...s, daily_meal_plan_id: 'p1', meal_template: mockMeals.find((m) => m.id === s.meal_template_id) })) });

/** Backend main's slot write (updatePlan, FOODLINK): the rows kept by (slot_label, order), the rest deleted and created anew. */
function mockServerPatch(body: Row) {
  const key = (s: Row) => `${s.slot_label}#${s.order}`;
  const next = (body.slots as Row[]).map((s, idx): Row => ({ ...s, order: s.order ?? idx }));
  const wanted = new Map(next.map((s) => [key(s), s]));
  const kept = mockSlots.filter((e) => wanted.has(key(e))).map((e) => ({ ...e, meal_template_id: wanted.get(key(e))!.meal_template_id }));
  const keptKeys = new Set(kept.map(key));
  const fresh = next.filter((s) => !keptKeys.has(key(s))).map((s, i) => ({ id: `new${i}`, ...s }));
  mockSlots = [...kept, ...fresh];
}

jest.mock('../../../../services/api', () => ({
  __esModule: true,
  foodApi: { search: () => Promise.resolve({ data: { results: [] } }) },
  default: {
    get: (url: string) => Promise.resolve({ data: url.startsWith('/coach/meal-templates') ? mockMeals : mockPlan() }),
    patch: (_url: string, body: Row) => { mockSent.push(body); mockServerPatch(body); return Promise.resolve({ data: mockPlan() }); },
    post: () => Promise.reject(new Error('not used')),
    delete: () => Promise.reject(new Error('not used')),
  },
}));
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: require('../../../../constants/colors').default,
  tokens: require('../../../../theme/tokens').default, semanticColors: require('../../../../theme/tokens').lightTokens }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({}), useFocusEffect: jest.fn(), usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), SafeAreaView: require('react-native').View }));
jest.mock('../../../../components/log/QuantityPickerModal', () => ({ __esModule: true, default: () => null }));

import MealPicker from '../MealPickerScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';

const slot = (id: string, meal_template_id: string, slot_label: string, order: number) => ({ id, meal_template_id, slot_label, order, time_of_day: null });
const mount = (index: number) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MealPicker {...({ route: { params: { planId: 'p1', index } }, navigation: mockNav } as any)} />
  </QueryClientProvider>,
);
/** Each meal's row id after the save: the client's logged foods stay on a meal only while its row id stays. */
const rows = () => Object.fromEntries(mockSlots.map((s) => [s.slot_label, s.id]));

beforeEach(() => {
  jest.clearAllMocks();
  mockSent.length = 0;
  for (const k of ['selection', 'success', 'error', 'mediumImpact'] as const) jest.spyOn(HapticService, k).mockResolvedValue();
  // The plan as the phone built it: Add a meal three times (orders 0, 1, 2).
  mockSlots = [slot('s-breakfast', 'm1', 'breakfast', 0), slot('s-lunch', 'm2', 'lunch', 1), slot('s-dinner', 'm3', 'dinner', 2)];
});

it.each([
  ['Remove breakfast (the first meal)', 0, 'Remove breakfast', { lunch: 's-lunch', dinner: 's-dinner' }],
  ['Remove lunch (a middle meal)', 1, 'Remove lunch', { breakfast: 's-breakfast', dinner: 's-dinner' }],
])('%s keeps the other meals’ rows, so the foods she logged for them stay ticked', async (_name, index, label, kept) => {
  const s = await mount(index);
  await fireEvent.press(await s.findByText(label));
  await waitFor(() => expect(mockNav.goBack).toHaveBeenCalled());
  expect(mockSent).toHaveLength(1);
  expect(rows()).toEqual(kept);
});

it('control: a swap of one meal keeps every row (the key does not move)', async () => {
  const s = await mount(1);
  await fireEvent.press(await s.findByTestId('pick-m1'));
  await waitFor(() => expect(mockNav.goBack).toHaveBeenCalled());
  expect(rows()).toEqual({ breakfast: 's-breakfast', lunch: 's-lunch', dinner: 's-dinner' });
});
