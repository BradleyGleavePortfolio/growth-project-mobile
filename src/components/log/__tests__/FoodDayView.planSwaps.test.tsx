// PLAN-SWAPS-M (C2 Style C C_changed and C_day; operator rulings R7, R10, R11): the coach's plan change note and the
// "Updated" mark on the Food day, and "Recipe and grocery list" under a plan meal with a recipe. Fictional data
// (client Jordan, coach Sam). Mounted at 390 x 844 at 100% and at 320 x 568 at 130%.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import type { FoodLog } from '../../../types';

const mockGet = jest.fn();
const mockDaily = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) }, logApi: { getDaily: (...a: unknown[]) => mockDaily(...a) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock('../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, foodPlanChecklist: true, youTabV2: true, clientTimelineV2: true, romanChat: true } };
});
let mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

// A fixed clock: Tuesday 24 November 2026, noon (only Date is faked).
jest.useFakeTimers({ now: new Date('2026-11-24T12:00:00'), advanceTimers: true, doNotFake: ['nextTick', 'setImmediate',
  'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const TODAY = '2026-11-24';

const tpl = (id: string, name: string, kcal: number, p: number, c: number, f: number) => ({
  id, coach_id: 'sam', name, description: null, calories_kcal: kcal, protein_g: p, carbs_g: c, fats_g: f, fiber_g: null,
  items: [{ name: 'Banana', portion: '1 medium' }], created_at: '', archived_at: null,
});
const slotOf = (id: string, label: string, t: ReturnType<typeof tpl>, time: string, extra: object = {}) => ({
  id, daily_meal_plan_id: 'p1', meal_template_id: t.id, slot_label: label, order: 0, time_of_day: time, meal_template: t, swaps: [], recipe_id: null, ...extra,
});
const daySlots = (dinnerRecipe: string | null = 'r1') => [
  slotOf('s-b', 'breakfast', tpl('m-b', 'Greek yoghurt, oats and berries', 420, 35, 48, 9), '07:30', { recipe_id: 'r0' }),
  slotOf('s-l', 'lunch', tpl('m-l', 'Chicken, rice and greens', 680, 45, 60, 14), '12:30'),
  slotOf('s-pre', 'preworkout', tpl('m-pre', 'Banana and whey shake', 250, 27, 30, 2), '17:30', { recipe_id: 'r2' }),
  slotOf('s-d', 'dinner', tpl('m-chilli', 'Turkey chilli with rice', 610, 48, 62, 16), '19:30', { recipe_id: dinnerRecipe }),
];
const CHANGE = { plan_id: 'p1', slot_id: 's-d', slot_label: 'dinner', from_template_id: 'm-salmon', from_name: 'Salmon, potatoes and green beans',
  to_template_id: 'm-chilli', to_name: 'Turkey chilli with rice', changed_at: new Date(`${TODAY}T11:20:00`).toISOString() };
const today = (changes: unknown[] = [CHANGE], s = daySlots(), notes: string | null = 'Protein at every meal. Water before coffee.') => ({
  date: TODAY, changes_today: changes,
  assignments: [{ daily_meal_plan: { id: 'p1', name: 'Training day', notes, slots: s } }],
});
const breakfast: FoodLog = { id: '1', userId: 'u', coachId: 'c', date: TODAY, mealType: 'breakfast', foodName: 'Greek yoghurt, oats and berries',
  calories: 420, protein: 35, carbs: 48, fat: 9, quantity: 1, unit: 'serving', createdAt: `${TODAY}T07:40:00.000`, planSlotId: 's-b' };
const lunch: FoodLog = { ...breakfast, id: '2', mealType: 'lunch', foodName: 'Chicken, rice and greens', calories: 680, createdAt: `${TODAY}T12:35:00.000`, planSlotId: 's-l' };

function serve(body: unknown, coach: string | null = 'Sam Reid') {
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) return { data: body };
    if (url === '/v1/clients/me/coach') return { data: coach ? { name: coach } : {} };
    if (url === '/assignments/me') return { data: { items: [], nextCursor: null } };
    throw new Error(`unexpected GET ${url}`);
  });
}
const handlers = { onDateChange: jest.fn(), onLogPlanned: jest.fn(), onRepeat: jest.fn(), onSomethingElse: jest.fn(), onEditFood: jest.fn() };
type Over = Partial<React.ComponentProps<typeof FoodDayGate>>;
async function show(over: Over = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached selectedDate={TODAY} foodLogs={[breakfast, lunch]} eaten={{ calories: 1100, protein: 80 }}
        targets={{ calories: 1850, protein: 150 }} ready saving={false} notes={null} water={<Text>Water card</Text>}
        nowMin={15 * 60 + 10} {...handlers} {...over}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
  mockDaily.mockResolvedValue({ data: { entries: [] } });
});

describe('case 2: S1, the coach changed a meal today (C_changed)', () => {
  it('puts the change note in the coach note\'s place, a status region, and one Updated pill on Dinner', async () => {
    serve(today());
    await show({ onOpenPlanMeal: jest.fn() });
    const note = await screen.findByTestId('food-day-change-note');
    expect(note).toHaveTextContent("Sam updated today's plan at 11:20 am. Dinner is now Turkey chilli with rice. Meals you already logged stay as they are.");
    expect(note.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.queryByText('“Protein at every meal. Water before coffee.”')).toBeNull();
    expect(screen.getAllByText('UPDATED')).toHaveLength(1);
    expect(screen.getByTestId('food-day-updated-s-d')).toBeTruthy();
    expect(screen.getByTestId('food-day-slot-s-d').props.accessibilityLabel).toMatch(/^7:30 pm\. Dinner, updated\. Turkey chilli with rice\./);
  });

  it('says "Your coach" with no coach name', async () => {
    serve(today(), null);
    await show();
    expect(await screen.findByTestId('food-day-change-note')).toHaveTextContent(/^Your coach updated today's plan at 11:20 am\./);
  });

  it('shows no note and no pill with no change rows, or on another day', async () => {
    serve(today([]));
    await show();
    expect(await screen.findByText('“Protein at every meal. Water before coffee.”')).toBeTruthy();
    expect(screen.queryByTestId('food-day-change-note')).toBeNull();
    expect(screen.queryByText('UPDATED')).toBeNull();
  });

  it('another day: no note and no pill even when rows come back', async () => {
    serve({ ...today(), date: '2026-11-23' });
    await show({ selectedDate: '2026-11-23', foodLogs: [], eaten: { calories: 0, protein: 0 } });
    expect(await screen.findByText("Sam's plan")).toBeTruthy();
    expect(screen.queryByTestId('food-day-change-note')).toBeNull();
    expect(screen.queryByText('UPDATED')).toBeNull();
  });
});

describe('case 3: S16, over target today with a change', () => {
  it('keeps main\'s over line in the note\'s place, shows no change note, and keeps the pill', async () => {
    serve(today());
    await show({ eaten: { calories: 2000, protein: 120 } });
    expect(await screen.findByText(/Tomorrow starts fresh at 1,850 kcal\./)).toBeTruthy();
    expect(screen.queryByTestId('food-day-change-note')).toBeNull();
    expect(screen.getByTestId('food-day-updated-s-d')).toBeTruthy();
  });
});

describe('case 4: S2, "Recipe and grocery list" on the Food day', () => {
  it('shows under a later meal, on the up-next card and on a done row, each its own button; none without a recipe', async () => {
    serve(today([]));
    const onOpenPlanMeal = jest.fn();
    await show({ onOpenPlanMeal });
    const later = await screen.findByTestId('food-day-recipe-s-d');
    expect(later).toHaveTextContent('Recipe and grocery list');
    expect(later.props.accessibilityLabel).toBe('Recipe and grocery list for Turkey chilli with rice');
    expect(within(screen.getByTestId('food-day-next')).getByTestId('food-day-recipe-s-pre')).toBeTruthy();
    expect(screen.getByTestId('food-day-recipe-s-b')).toBeTruthy();
    expect(screen.queryByTestId('food-day-recipe-s-l')).toBeNull();
    // Never inside the row's own pressable.
    expect(within(screen.getByTestId('food-day-slot-s-d')).queryByTestId('food-day-recipe-s-d')).toBeNull();
    await fireEvent.press(later);
    expect(onOpenPlanMeal).toHaveBeenCalledWith('s-d');
    expect(handlers.onSomethingElse).not.toHaveBeenCalled();
  });

  it('shows no link without the prop', async () => {
    serve(today([]));
    await show();
    expect(await screen.findByTestId('food-day-next')).toBeTruthy();
    expect(screen.queryByText('Recipe and grocery list')).toBeNull();
  });
});

describe('case 10: S15, coachless and the usual day', () => {
  it('a client with no coach sees no note, no pill, no link and no coach, Roman or plan words', async () => {
    serve(today());
    mockDaily.mockResolvedValue({ data: { entries: [] } });
    await show({ coached: false, onOpenPlanMeal: jest.fn() });
    expect(await screen.findByText('Log what you eat today')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/me\/meal-plan/));
    expect(screen.queryByTestId('food-day-change-note')).toBeNull();
    expect(screen.queryByText('UPDATED')).toBeNull();
    expect(screen.queryByText('Recipe and grocery list')).toBeNull();
    expect(screen.queryByText(/Sam|Roman|updated today's plan/)).toBeNull();
  });
});

describe('case 11: 320 x 568 at 130%', () => {
  it('no numberOfLines on the note, the pill or the link, and the link is 44 pt tall', async () => {
    mockWindow = { width: 320, height: 568, scale: 2, fontScale: 1.3 };
    serve(today());
    await show({ onOpenPlanMeal: jest.fn() });
    const note = await screen.findByTestId('food-day-change-note');
    expect(note.props.numberOfLines).toBeUndefined();
    expect(within(screen.getByTestId('food-day-updated-s-d')).getByText('UPDATED').props.numberOfLines).toBeUndefined();
    const link = screen.getByTestId('food-day-recipe-s-pre');
    expect(StyleSheet.flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });
});
