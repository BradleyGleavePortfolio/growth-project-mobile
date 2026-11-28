/**
 * PREWORKOUT-EATEN-M (SWEEP-FOOD-LOG B1), the plan meal page (PlanMealScreen.tsx:247): "Ate it as planned" on a
 * pre-workout meal logs it in one tap, with no meal chooser. On the page's next open, with the day's log as the server
 * stores that write (meal_type as sent, the plan meal's id), the meal reads "Logged as planned" and "Ate it as planned"
 * is not offered again. Harness from PlanMealScreen.LO1009B1.test.tsx; every switch on ([R27]).
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanMealScreen from '../PlanMealScreen';

jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, offlineFoodInDay: true, youTabV2: true, clientTimelineV2: true, romanChat: true } };
});
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { date: '2026-11-24', slotId: 's-pre' } }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
const mockGet = jest.fn();
const mockDaily = jest.fn();
const mockCreate = jest.fn();
const mockLogFood = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  recipesApi: { getById: jest.fn() },
  listsApi: { bulkAdd: jest.fn() },
  logApi: { getDaily: (...a: unknown[]) => mockDaily(...a), deleteEntry: jest.fn(), logFood: (...a: unknown[]) => mockLogFood(...a) },
  foodApi: { create: (...a: unknown[]) => mockCreate(...a) },
}));

// A fixed clock: Tuesday 24 November 2026, 3:10 pm (only Date is faked).
jest.useFakeTimers({ now: new Date('2026-11-24T15:10:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());

const TODAY = '2026-11-24';
const preTpl = {
  id: 'm-pre', coach_id: 'sam', name: 'Banana and whey shake', description: null, calories_kcal: 250, protein_g: 27, carbs_g: 30, fats_g: 2,
  fiber_g: null, items: [{ name: 'Banana', portion: '1 medium' }, { name: 'Whey protein', grams: 30 }, { name: 'Water' }], created_at: '', archived_at: null,
};
const dinnerTpl = {
  id: 'm-din', coach_id: 'sam', name: 'Salmon, potatoes and green beans', description: null,
  calories_kcal: 620, protein_g: 42, carbs_g: 55, fats_g: 22, fiber_g: null, items: null, created_at: '', archived_at: null,
};
const today = {
  date: TODAY, changes_today: [],
  assignments: [{ id: 'a1', daily_meal_plan: { id: 'p1', coach_id: 'sam', name: 'Training day', notes: null, slots: [
    { id: 's-pre', daily_meal_plan_id: 'p1', meal_template_id: 'm-pre', slot_label: 'preworkout', order: 0, time_of_day: '17:30', meal_template: preTpl, swaps: [], recipe_id: null },
    { id: 's-din', daily_meal_plan_id: 'p1', meal_template_id: 'm-din', slot_label: 'dinner', order: 0, time_of_day: '19:30', meal_template: dinnerTpl, swaps: [], recipe_id: null },
  ] } }],
};

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PlanMealScreen /></QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) return { data: today };
    if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
    throw new Error(`unexpected GET ${url}`);
  });
  mockDaily.mockResolvedValue({ data: { entries: [] } });
  mockCreate.mockResolvedValue({ data: { id: 'food-1' } });
  mockLogFood.mockResolvedValue({ data: { id: 'entry-1' } });
});

it('a pre-workout meal: one tap, no chooser; on the next open it is eaten and not offered again', async () => {
  const first = await open();
  expect(await screen.findByText('Ate it as planned')).toBeTruthy();
  await fireEvent.press(screen.getByText('Ate it as planned'));
  // Her path where the app asks which meal: a 5:30 pm pre-workout shake before a 7:30 pm dinner is a snack or lunch to
  // her; she picks Lunch.
  const asked = screen.queryByText('Choose the meal to add it to.') != null;
  if (asked) {
    const lunch = screen.getAllByRole('radio').find((r) => within(r).queryByText('Lunch'));
    if (lunch) await fireEvent.press(lunch);
    await fireEvent.press(screen.getByText(/^Log to /));
  }
  await screen.findByText(/^Added to today's /);
  expect(mockLogFood).toHaveBeenCalledTimes(1);
  const sent = mockLogFood.mock.calls[0][0] as { meal_type: string; plan_slot_id?: string; quantity_multiplier: number };
  expect(sent.plan_slot_id).toBe('s-pre');

  // The page opened again: the day's log holds the entry as the server stored it.
  first.unmount();
  mockDaily.mockResolvedValue({ data: { entries: [{
    id: 'entry-1', food_item_id: 'food-1', user_id: 'client-1', meal_type: sent.meal_type, plan_slot_id: sent.plan_slot_id ?? null,
    quantity_multiplier: sent.quantity_multiplier, original_quantity: 1, original_unit: 'serving',
    food_item: { id: 'food-1', name: 'Banana and whey shake', calories: 250, protein_g: 27, carbs_g: 30, fat_g: 2, nutrient_basis: 'PER_SERVING' },
  }] } });
  await open();
  expect(await screen.findByText('Banana and whey shake')).toBeTruthy();
  expect(await screen.findByTestId('plan-meal-status')).toHaveTextContent('Logged as planned');
  expect(screen.queryByText('Ate it as planned')).toBeNull();

  // One tap, no chooser: the meal went to Snacks, the meal the Food day counts it under.
  expect(asked).toBe(false);
  expect(sent.meal_type).toBe('snack');
});
