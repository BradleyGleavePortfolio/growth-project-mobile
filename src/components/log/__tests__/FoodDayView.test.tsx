// UI-3 day checklist: every tap on the coached plan day and the coachless usual day arrives somewhere real,
// and the classic Food log stays reachable when the flag is off, there is no plan or usual meal, or a read fails.
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { addDays, getTodayString } from '../../../utils/date';
import { weekday } from '../../../utils/log/foodDay';
import type { FoodLog } from '../../../types';

const mockGet = jest.fn();
const mockNavigate = jest.fn();
const mockDaily = jest.fn();
const mockMessageCoach = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) }, logApi: { getDaily: (...a: unknown[]) => mockDaily(...a) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: mockMessageCoach }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

const today = getTodayString();
const template = (name: string, kcal: number, items: unknown[] = []) => ({
  name, calories_kcal: kcal, protein_g: 30, carbs_g: 20, fats_g: 5, items,
});
const planDay = { date: today, assignments: [{ daily_meal_plan: { name: 'Lean week 2', notes: 'Protein first at lunch.', slots: [
  { id: 'b', slot_label: 'breakfast', order: 0, meal_template: template('Overnight oats', 390) },
  { id: 's', slot_label: 'snack', order: 0, meal_template: template('Greek yogurt and berries', 210, [{ name: 'Greek yogurt', grams: 250 }]) },
  { id: 'd', slot_label: 'dinner', order: 0, meal_template: template('Salmon and rice', 610) },
] } }] };
const log = (id: string, mealType: FoodLog['mealType'], foodName: string, calories: number): FoodLog => ({
  id, userId: 'u', coachId: 'c', date: today, mealType, foodName, calories, protein: 20, carbs: 10, fat: 5,
  quantity: 1, unit: 'serving', createdAt: `${today}T08:00:00.000`,
});
const logs = [log('1', 'breakfast', 'Overnight oats', 390), log('2', 'lunch', 'Coffee with milk', 30)];

function serve(plan: unknown, fail = false) {
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) {
      if (fail) throw Object.assign(new Error('Network Error'), { isAxiosError: true });
      return { data: plan };
    }
    if (url === '/v1/clients/me/coach') return { data: { name: 'Jordan Hale' } };
    throw new Error(`unexpected GET ${url}`);
  });
}

const props = {
  onDateChange: jest.fn(), onLogPlanned: jest.fn(), onRepeat: jest.fn(), onSomethingElse: jest.fn(), onEditFood: jest.fn(),
};
type Over = Partial<React.ComponentProps<typeof FoodDayGate>>;
async function show(over: Over = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (o: Over) => (
    <QueryClientProvider client={client}>
      <FoodDayGate on coached selectedDate={today} foodLogs={logs} eaten={{ calories: 420, protein: 40 }}
        targets={{ calories: 1250, protein: 120 }} ready saving={false} notes={null} water={<Text>Water card</Text>}
        {...props} {...o}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>
  );
  const view = await render(tree(over));
  return Object.assign(view, { client, update: (o: Over) => view.rerender(tree(o)) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDaily.mockResolvedValue({ data: { entries: [] } });
});

it('shows the coach plan as a checklist with the next meal ready to log', async () => {
  serve(planDay);
  await show();
  expect(await screen.findByText("Jordan's plan for today")).toBeTruthy();
  expect(screen.getByText("Today's meals")).toBeTruthy();
  expect(screen.getByText('Lean week 2, 1,210 kcal, 90 g protein')).toBeTruthy();
  expect(screen.getByText('\u201CProtein first at lunch.\u201D')).toBeTruthy();
  expect(screen.getByText('1 of 3 meals done')).toBeTruthy();
  expect(screen.getByText('420 of 1,210 kcal')).toBeTruthy();
  expect(screen.getByText('Logged as planned')).toBeTruthy();
  expect(screen.getByText('UP NEXT, SNACK')).toBeTruthy();
  expect(screen.getByText('Greek yogurt')).toBeTruthy();
  expect(screen.getByText('250 g')).toBeTruthy();
  expect(screen.getByText('EXTRAS, NOT IN THE PLAN')).toBeTruthy();
  expect(screen.getByText('Logged to lunch')).toBeTruthy();
  expect(screen.getByText('Water card')).toBeTruthy();
  expect(screen.getByText('1,240 kcal and 100 g protein.')).toBeTruthy();
  expect(screen.queryByText('Classic food log')).toBeNull();
});

it('sends every tap to a real Food log path', async () => {
  serve(planDay);
  await show();
  await fireEvent.press(await screen.findByTestId('food-day-primary'));
  expect(props.onLogPlanned).toHaveBeenCalledWith(expect.objectContaining({ name: 'Greek yogurt and berries', mealType: 'snack', kcal: 210 }));
  await fireEvent.press(screen.getByTestId('food-day-something-else'));
  expect(props.onSomethingElse).toHaveBeenLastCalledWith('snack');
  await fireEvent.press(screen.getByLabelText('Coffee with milk, logged to lunch, 30 kcal'));
  expect(props.onEditFood).toHaveBeenLastCalledWith(logs[1]);
  await fireEvent.press(screen.getByTestId('food-day-slot-b'));
  await fireEvent.press(screen.getByLabelText('Overnight oats, 390 kcal'));
  expect(props.onEditFood).toHaveBeenLastCalledWith(logs[0]);
  await fireEvent.press(screen.getByLabelText('Previous day'));
  await fireEvent.press(screen.getByLabelText('Next day'));
  expect(props.onDateChange).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByTestId('food-day-bell'));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter', initial: false });
});

it('keeps an extra out of a day with every meal open, and lets Something else fill the meal up next', async () => {
  serve(planDay);
  const coffee = log('9', 'breakfast', 'Coffee with milk', 30);
  const view = await show({ foodLogs: [], eaten: { calories: 0, protein: 0 } });
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  expect(props.onSomethingElse).toHaveBeenLastCalledWith('breakfast');
  await view.update({ foodLogs: [coffee], eaten: { calories: 30, protein: 20 } });
  expect(screen.getByText('UP NEXT, BREAKFAST')).toBeTruthy();
  expect(screen.getByText('0 of 3 meals done')).toBeTruthy();
  expect(screen.getByText('Logged to breakfast')).toBeTruthy();
  expect(screen.getByText('1,240 kcal and 110 g protein.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('food-day-something-else'));
  expect(props.onSomethingElse).toHaveBeenLastCalledWith('breakfast');
  await view.update({ foodLogs: [coffee, log('10', 'breakfast', 'Toast', 200)], eaten: { calories: 230, protein: 40 } });
  expect(await screen.findByText('Logged with a change: Toast')).toBeTruthy();
  expect(screen.getByText('UP NEXT, SNACK')).toBeTruthy();
  expect(screen.getByText('Logged to breakfast')).toBeTruthy();
  expect(view.client.getQueryData(['food-day-changes', today])).toEqual({ 10: 'b' });
});

it('says the target is met when the rest of the plan lands within 5 percent', async () => {
  serve(planDay);
  await show({ targets: { calories: 1240, protein: 100 } });
  expect(await screen.findByText('1,240 kcal and 100 g protein. Both on target.')).toBeTruthy();
});

it('keeps the classic log open while the plan is still loading', async () => {
  mockGet.mockReturnValue(new Promise(() => {}));
  await show();
  expect(screen.getByText('Classic food log')).toBeTruthy();
  expect(screen.queryByTestId('food-day')).toBeNull();
});

it('keeps the classic log when the plan cannot load, with a working retry', async () => {
  serve(planDay, true);
  await show();
  expect(await screen.findByText('Your meal plan could not load. Check your connection, then try again.')).toBeTruthy();
  expect(screen.getByText('Classic food log')).toBeTruthy();
  serve(planDay);
  await fireEvent.press(screen.getByTestId('food-day-plan-error-retry'));
  expect(await screen.findByText("Jordan's plan for today")).toBeTruthy();
});

it('shows the classic log with no plan, no usual meal, or the flag off', async () => {
  serve({ date: today, assignments: [] });
  const first = await show();
  expect(await screen.findByText('Classic food log')).toBeTruthy();
  await first.unmount();
  const second = await show({ coached: false });
  await waitFor(() => expect(mockDaily).toHaveBeenCalledTimes(7));
  expect(await screen.findByText('Classic food log')).toBeTruthy();
  await second.unmount();
  await show({ on: false });
  expect(screen.getByText('Classic food log')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledTimes(2);
});

const entry = (meal: string, id: string, name: string, kcal: number, qty: number, unit: string) => ({
  meal_type: meal, food_item_id: id, quantity_multiplier: 1, original_quantity: qty, original_unit: unit,
  food_item: { id, name, calories_per_serving: kcal, protein: 4, carbs: 20, fat: 8, nutrient_basis: 'PER_SERVING' },
});
const snack = [entry('snack', 'apple', 'Apple, medium', 95, 1, 'medium'), entry('snack', 'pb', 'Peanut butter', 95, 1, 'tbsp')];
const dinner = [entry('dinner', 'chili', 'Turkey chili', 450, 1, 'bowl'), entry('dinner', 'cheddar', 'Cheddar', 70, 20, 'g')];
const past: Record<string, unknown[]> = {
  [addDays(today, -1)]: snack, [addDays(today, -2)]: dinner, [addDays(today, -4)]: snack, [addDays(today, -5)]: dinner,
  [addDays(today, -6)]: [entry('lunch', 'soup', 'Lentil soup', 300, 1, 'bowl')],
};

it('builds the usual day for a client with no coach, ready to repeat', async () => {
  mockDaily.mockImplementation(async (date: string) => ({ data: { entries: past[date] ?? [] } }));
  await show({ coached: false, foodLogs: [logs[0]], eaten: { calories: 390, protein: 20 } });
  expect(await screen.findByText('Your usual day')).toBeTruthy();
  expect(screen.getByText('Built from the meals you logged this week. 1,250 kcal target.')).toBeTruthy();
  // No usual breakfast, so the oats logged today are an extra, not a meal of the usual day.
  expect(screen.getByText('0 of 2 meals logged')).toBeTruthy();
  expect(screen.getByText('390 of 1,250 kcal')).toBeTruthy();
  expect(screen.getByText('Logged to breakfast')).toBeTruthy();
  expect(screen.getByText('UP NEXT, YOUR USUAL SNACK')).toBeTruthy();
  expect(screen.getByText('Apple, medium and Peanut butter')).toBeTruthy();
  expect(screen.getByText(`Logged yesterday and on ${weekday(addDays(today, -4))}`)).toBeTruthy();
  expect(screen.getByText('1 tbsp')).toBeTruthy();
  expect(screen.getByText('Your usual: Turkey chili and Cheddar')).toBeTruthy();
  expect(screen.getByText(`2 foods, 8 g protein, last on ${weekday(addDays(today, -2))}`)).toBeTruthy();
  expect(screen.queryByText('Lentil soup')).toBeNull();
  expect(screen.getByText('EXTRAS')).toBeTruthy();
  expect(screen.queryByTestId('food-day-projection')).toBeNull();
  expect(mockGet).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText("Repeat yesterday's snack"));
  expect(props.onRepeat).toHaveBeenCalledWith(expect.objectContaining({
    mealType: 'snack',
    usual: expect.objectContaining({ meal: expect.objectContaining({ date: addDays(today, -1), entries: [
      { foodItemId: 'apple', name: 'Apple, medium', calories: 95, quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'medium' },
      { foodItemId: 'pb', name: 'Peanut butter', calories: 95, quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'tbsp' },
    ] }) }),
  }));
  await fireEvent.press(screen.getByTestId('food-day-something-else'));
  expect(props.onSomethingElse).toHaveBeenLastCalledWith('snack');
  expect(screen.getByText('MEAL PLANS COME FROM A COACH')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Join a coach'));
  expect(mockMessageCoach).toHaveBeenCalledTimes(1);
});

it('keeps an extra out of a usual day with four meals open, and lets Something else fill the meal up next', async () => {
  const four = [entry('breakfast', 'eggs', 'Eggs', 140, 2, 'large'), entry('lunch', 'soup', 'Lentil soup', 300, 1, 'bowl'), ...snack, ...dinner];
  mockDaily.mockImplementation(async (date: string) => ({ data: { entries: [addDays(today, -1), addDays(today, -3)].includes(date) ? four : [] } }));
  const coffee = log('9', 'breakfast', 'Coffee with milk', 30);
  const view = await show({ coached: false, foodLogs: [], eaten: { calories: 0, protein: 0 } });
  await fireEvent.press(await screen.findByTestId('food-day-add'));
  expect(props.onSomethingElse).toHaveBeenLastCalledWith('breakfast');
  await view.update({ coached: false, foodLogs: [coffee], eaten: { calories: 30, protein: 20 } });
  expect(screen.getByText('UP NEXT, YOUR USUAL BREAKFAST')).toBeTruthy();
  expect(screen.getByText('0 of 4 meals logged')).toBeTruthy();
  expect(screen.getByText('Logged to breakfast')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('food-day-something-else'));
  expect(props.onSomethingElse).toHaveBeenLastCalledWith('breakfast');
  await view.update({ coached: false, foodLogs: [coffee, log('10', 'breakfast', 'Toast', 200)], eaten: { calories: 230, protein: 40 } });
  expect(await screen.findByText('UP NEXT, YOUR USUAL LUNCH')).toBeTruthy();
  expect(screen.getByText('1 of 4 meals logged')).toBeTruthy();
  expect(screen.getByText('Toast')).toBeTruthy();
  expect(screen.queryByText('1 food')).toBeNull();
  expect(screen.getByText('Logged to breakfast')).toBeTruthy();
  expect(view.client.getQueryData(['food-day-changes', today])).toEqual({ 10: 'breakfast' });
});
