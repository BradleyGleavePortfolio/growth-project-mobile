// LO-930 B-TEST (Opus lens): on the first day (C_first) a meal with two foods must let the client open each food,
// so a wrong food can be edited or deleted, as the classic log does on main.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { getTodayString } from '../../../utils/date';
import type { FoodLog } from '../../../types';

const mockGet = jest.fn();
const mockDaily = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) }, logApi: { getDaily: (...a: unknown[]) => mockDaily(...a) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));

const today = getTodayString();
const template = (name: string, kcal: number, protein: number, items: unknown[] = []) => ({
  name, calories_kcal: kcal, protein_g: protein, carbs_g: 20, fats_g: 5, items,
});
const plan = (slots: unknown[], notes: string | null = 'Protein at every meal. Water before coffee.') =>
  ({ date: today, assignments: [{ daily_meal_plan: { id: 'p1', name: 'Lean week 2', notes, slots } }] });
const timed = plan([
  { id: 'b', slot_label: 'breakfast', order: 0, time_of_day: '07:30', meal_template: template('Greek yoghurt, oats and berries', 420, 32) },
  { id: 'l', slot_label: 'lunch', order: 0, time_of_day: '12:30', meal_template: template('Chicken, rice and greens', 680, 45) },
  { id: 'p', slot_label: 'preworkout', order: 0, time_of_day: '17:30', meal_template: template('Banana and whey shake', 250, 28,
    [{ name: 'Banana', portion: '1 medium' }, { name: 'Whey protein', grams: 30 }]) },
  { id: 'd', slot_label: 'dinner', order: 0, time_of_day: '19:30', meal_template: template('Salmon and greens', 620, 40) },
]);
const untimed = plan([
  { id: 'b', slot_label: 'breakfast', order: 0, meal_template: template('Overnight oats', 390, 30) },
  { id: 'l', slot_label: 'lunch', order: 0, meal_template: template('Tuna salad', 450, 35) },
]);
const log = (id: string, mealType: FoodLog['mealType'], foodName: string, calories: number, hhmm: string, planSlotId?: string): FoodLog => ({
  id, userId: 'u', coachId: 'c', date: today, mealType, foodName, calories, protein: 30, carbs: 10, fat: 5,
  quantity: 1, unit: 'serving', createdAt: `${today}T${hhmm}:00.000`, planSlotId,
});
const breakfast = log('1', 'breakfast', 'Greek yoghurt, oats and berries', 420, '07:40', 'b');
const flatWhite = log('2', 'snack', 'Flat white', 110, '10:15');
const lunch = log('3', 'lunch', 'Chicken, rice and greens', 680, '12:35', 'l');
// C_day's own numbers: breakfast, the flat white and lunch eaten (1,210 kcal, 87 g protein) of 1,850 kcal and 150 g.
const cDay = { foodLogs: [breakfast, flatWhite, lunch], eaten: { calories: 1210, protein: 87 } };

let workouts: unknown[] = [];
function serve(body: unknown, fail = false) {
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) {
      if (fail) throw Object.assign(new Error('Network Error'), { isAxiosError: true });
      return { data: body };
    }
    if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
    if (url === '/assignments/me') return { data: { items: workouts, nextCursor: null } };
    throw new Error(`unexpected GET ${url}`);
  });
}

const props = { onDateChange: jest.fn(), onLogPlanned: jest.fn(), onRepeat: jest.fn(), onSomethingElse: jest.fn(), onEditFood: jest.fn() };
type Over = Partial<React.ComponentProps<typeof FoodDayGate>>;
async function show(over: Over = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (o: Over) => (
    <QueryClientProvider client={client}>
      <FoodDayGate on coached selectedDate={today} foodLogs={[breakfast, flatWhite]} eaten={{ calories: 530, protein: 60 }}
        targets={{ calories: 1850, protein: 150 }} ready saving={false} notes={null} water={<Text>Water card</Text>}
        nowMin={15 * 60 + 10} {...props} {...o}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>
  );
  const view = await render(tree(over));
  return Object.assign(view, { update: (o: Over) => view.rerender(tree(o)) });
}
const order = () => screen.getAllByTestId(/^food-day-(slot|extra|now|workout|next)\b/).map((n) => n.props.testID as string);
const colorsIn = (node: { props: { style?: unknown } }) => JSON.stringify(StyleSheet.flatten(node.props.style as never) ?? {});

beforeEach(() => {
  jest.clearAllMocks();
  workouts = [];
  mockDaily.mockResolvedValue({ data: { entries: [] } });
});

describe('LO-930 B1: C_first meal with two foods', () => {
  it('C_first: each of two foods in one meal opens its own edit sheet (edit or delete)', async () => {
    serve(timed);
    const oats = log('6', 'breakfast', 'Rolled oats', 300, '08:05');
    const banana = log('7', 'breakfast', 'Banana', 105, '08:06');
    await show({ coached: false, foodLogs: [oats, banana], eaten: { calories: 405, protein: 12 }, nowMin: 9 * 60 });
    const row = await screen.findByTestId('food-day-first-breakfast');
    await fireEvent.press(row);
    // The client must reach each food; at the head the tap only opens the search sheet.
    await fireEvent.press(screen.getByLabelText(/^Banana/));
    expect(props.onEditFood).toHaveBeenCalledWith(banana);
  });
});
