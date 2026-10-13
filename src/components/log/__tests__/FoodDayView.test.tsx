// UI-3 plan checklist: every tap on the coached Food day arrives somewhere real, and the classic Food
// log stays reachable when the flag is off, the client has no coach, the day has no plan or it fails.
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { getTodayString } from '../../../utils/date';
import type { FoodLog } from '../../../types';

const mockGet = jest.fn();
const mockNavigate = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

const today = getTodayString();
const template = (name: string, kcal: number, items: unknown[] = []) => ({
  name, calories_kcal: kcal, protein_g: 30, carbs_g: 20, fats_g: 5, items,
});
const planDay = {
  date: today,
  assignments: [{
    daily_meal_plan: {
      name: 'Lean week 2', notes: 'Protein first at lunch.',
      slots: [
        { id: 'b', slot_label: 'breakfast', order: 0, meal_template: template('Overnight oats', 390) },
        { id: 's', slot_label: 'snack', order: 0, meal_template: template('Greek yogurt and berries', 210, [{ name: 'Greek yogurt', grams: 250 }]) },
        { id: 'd', slot_label: 'dinner', order: 0, meal_template: template('Salmon and rice', 610) },
      ],
    },
  }],
};
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
  onDateChange: jest.fn(), onLogPlanned: jest.fn(), onSomethingElse: jest.fn(), onEditFood: jest.fn(),
};
function show(over: Partial<React.ComponentProps<typeof FoodDayGate>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached selectedDate={today} foodLogs={logs} eaten={{ calories: 420, protein: 40 }}
        targets={{ calories: 1250, protein: 120 }} ready saving={false} notes={null} water={<Text>Water card</Text>}
        {...props} {...over}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

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
  fireEvent.press(await screen.findByTestId('food-day-primary'));
  expect(props.onLogPlanned).toHaveBeenCalledWith(expect.objectContaining({ name: 'Greek yogurt and berries', mealType: 'snack', kcal: 210 }));
  fireEvent.press(screen.getByTestId('food-day-something-else'));
  expect(props.onSomethingElse).toHaveBeenLastCalledWith('snack');
  fireEvent.press(screen.getByTestId('food-day-add'));
  expect(props.onSomethingElse).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByLabelText('Coffee with milk, logged to lunch, 30 kcal'));
  expect(props.onEditFood).toHaveBeenLastCalledWith(logs[1]);
  fireEvent.press(screen.getByTestId('food-day-slot-b'));
  fireEvent.press(screen.getByLabelText('Overnight oats, 390 kcal'));
  expect(props.onEditFood).toHaveBeenLastCalledWith(logs[0]);
  fireEvent.press(screen.getByLabelText('Previous day'));
  fireEvent.press(screen.getByLabelText('Next day'));
  expect(props.onDateChange).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByTestId('food-day-bell'));
  expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'NotificationCenter', initial: false });
});

it('says the target is met when the rest of the plan lands within 5 percent', async () => {
  serve(planDay);
  await show({ targets: { calories: 1240, protein: 100 } });
  expect(await screen.findByText('1,240 kcal and 100 g protein. Both on target.')).toBeTruthy();
});

it('keeps the classic log when the plan cannot load, with a working retry', async () => {
  serve(planDay, true);
  await show();
  expect(await screen.findByText('Your meal plan could not load. Check your connection, then try again.')).toBeTruthy();
  expect(screen.getByText('Classic food log')).toBeTruthy();
  serve(planDay);
  fireEvent.press(screen.getByTestId('food-day-plan-error-retry'));
  expect(await screen.findByText("Jordan's plan for today")).toBeTruthy();
});

it('shows the classic log with no plan, no coach, or the flag off', async () => {
  serve({ date: today, assignments: [] });
  const { unmount } = await show();
  expect(await screen.findByText('Classic food log')).toBeTruthy();
  unmount();
  await show({ coached: false });
  expect(screen.getByText('Classic food log')).toBeTruthy();
  await show({ on: false });
  expect(mockGet).toHaveBeenCalledTimes(2);
});
