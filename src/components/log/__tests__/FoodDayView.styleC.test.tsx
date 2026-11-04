// FOOD-DAY-STYLEC-M (C2 Style C slice C1, owner #191-E3 "m#916 in Style C ... make it exactly as I wanted"): the Food
// tab's day as the picked C2 Style C frames draw it (C_day, C_over, C_offline, C_loading, C_usual, C_workout, C_first).
// Behind featureFlags.foodPlanChecklist (FoodDayGate `on`); with it off the classic Food log shows, as on main.
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

describe('C_day: masthead, timeline and now line', () => {
  it('draws the coach page: masthead with the note and what is left, then the day in clock order with the now line', async () => {
    serve(timed);
    await show(cDay);
    expect(await screen.findByText("Sam's plan for today")).toBeTruthy();
    expect(screen.getByTestId('food-day-masthead')).toBeTruthy();
    expect(screen.getByText('\u201CProtein at every meal. Water before coffee.\u201D')).toBeTruthy();
    expect(screen.getByText('640 kcal and 63 g protein left.')).toBeTruthy();
    expect(order()).toEqual(['food-day-slot-b', 'food-day-extra-2', 'food-day-slot-l', 'food-day-now', 'food-day-next', 'food-day-slot-d']);
    // Each entry: time, meal, name, calories (section 5).
    const b = screen.getByTestId('food-day-slot-b');
    expect(within(b).getByText('7:40 am')).toBeTruthy();
    expect(within(b).getByText('BREAKFAST')).toBeTruthy();
    expect(within(b).getByText('420 KCAL')).toBeTruthy();
    expect(within(b).getByText('Logged as planned')).toBeTruthy();
    const x = screen.getByTestId('food-day-extra-2');
    expect([within(x).getByText('10:15 am'), within(x).getByText('EXTRAS, NOT IN THE PLAN'), within(x).getByText('Logged to snack')]).toBeTruthy();
    // A done meal shows when it was logged, a meal still to eat the coach's time; the now line shows the clock.
    expect(within(screen.getByTestId('food-day-slot-l')).getByText('12:35 pm')).toBeTruthy();
    expect(within(screen.getByTestId('food-day-next')).getByText('5:30 pm')).toBeTruthy();
    expect(within(screen.getByTestId('food-day-slot-d')).getByText('7:30 pm')).toBeTruthy();
    expect(within(screen.getByTestId('food-day-now')).getByText('3:10 pm')).toBeTruthy();
    expect(within(screen.getByTestId('food-day-next')).getByText('UP NEXT, PRE-WORKOUT')).toBeTruthy();
    expect(within(screen.getByTestId('food-day-next')).getByText('Banana 1 medium, Whey protein 30 g')).toBeTruthy();
    expect(screen.getByText('Water card')).toBeTruthy();
    expect(screen.queryByText('Classic food log')).toBeNull();
    expect(screen.queryByText(/Roman/)).toBeNull();
  });

  it('keeps every tap: Ate it as planned, Something else for the plan meal, Add never ticks a meal, edit, day arrows', async () => {
    serve(timed);
    await show();
    await fireEvent.press(await screen.findByTestId('food-day-primary'));
    expect(props.onLogPlanned).toHaveBeenCalledWith(expect.objectContaining({ key: 'l', name: 'Chicken, rice and greens' }));
    await fireEvent.press(screen.getByTestId('food-day-something-else'));
    expect(props.onSomethingElse).toHaveBeenLastCalledWith('lunch', { planSlotId: 'l' });
    await fireEvent.press(screen.getByTestId('food-day-add'));
    expect(props.onSomethingElse).toHaveBeenLastCalledWith('lunch');
    expect(screen.getByLabelText('Add food at 3:10 pm')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Flat white, logged to snack, 110 kcal'));
    expect(props.onEditFood).toHaveBeenLastCalledWith(flatWhite);
    await fireEvent.press(screen.getByLabelText('Previous day'));
    await fireEvent.press(screen.getByLabelText('Next day'));
    expect(props.onDateChange.mock.calls.length).toBe(2);
  });

  it('keeps plan order and shows no time for plan meals the coach gave no time', async () => {
    serve(untimed);
    await show({ foodLogs: [], eaten: { calories: 0, protein: 0 }, nowMin: 9 * 60 });
    expect(await screen.findByText("Sam's plan for today")).toBeTruthy();
    expect(order()).toEqual(['food-day-now', 'food-day-next', 'food-day-slot-l']);
    expect(within(screen.getByTestId('food-day-slot-l')).queryByText(/\d:\d\d [ap]m/)).toBeNull();
    expect(within(screen.getByTestId('food-day-next')).getByText('UP NEXT, BREAKFAST')).toBeTruthy();
  });

  it('draws no now line on another day', async () => {
    serve(timed);
    await show({ selectedDate: '2026-01-05', foodLogs: [] });
    expect(await screen.findByTestId('food-day-masthead')).toBeTruthy();
    expect(screen.queryByTestId('food-day-now')).toBeNull();
  });
});

describe('C_workout: the workout from Train on the same line', () => {
  it('shows the workout at its time and says the pre-workout meal logs under Snacks', async () => {
    workouts = [{ id: 'w1', scheduled_for: today, scheduled_time: '18:00', completed_at: null, workout_plan: { name: 'Full body A' } }];
    serve(timed);
    await show(cDay);
    const w = await screen.findByTestId('food-day-workout');
    expect([within(w).getByText('WORKOUT'), within(w).getByText('Full body A'), within(w).getByText('6:00 pm')]).toBeTruthy();
    expect(order()).toEqual(['food-day-slot-b', 'food-day-extra-2', 'food-day-slot-l', 'food-day-now', 'food-day-next', 'food-day-workout', 'food-day-slot-d']);
    expect(within(screen.getByTestId('food-day-next')).getByText('Before Full body A at 6:00 pm. Logs under Snacks.')).toBeTruthy();
  });

  it('says only "Before Full body A" when the workout has no time', async () => {
    workouts = [{ id: 'w1', scheduled_for: today, completed_at: null, workout_plan: { name: 'Full body A' } }];
    serve(timed);
    await show(cDay);
    expect(await screen.findByText('Before Full body A. Logs under Snacks.')).toBeTruthy();
  });
});

describe('C_over: over target in calm words, never red', () => {
  it('says how far above the target and what tomorrow starts at', async () => {
    serve(timed);
    await show({ eaten: { calories: 2080, protein: 154 } });
    expect(await screen.findByText("230 kcal above today's target. Protein 154 of 150 g.")).toBeTruthy();
    expect(screen.getByText('Tomorrow starts fresh at 1,850 kcal.')).toBeTruthy();
    expect(screen.queryByText(/left\.$/)).toBeNull();
    const line = screen.getByText("230 kcal above today's target. Protein 154 of 150 g.");
    expect(colorsIn(line)).not.toMatch(/#B91C1C|#DC2626|red/i);
  });
});

describe('C_offline: the pending note on the page', () => {
  it('shows the note LogScreen gives at the top of the page, read once', async () => {
    serve(timed);
    await show({ notes: <Text testID="pending">1 food saved offline is not in this log or its totals yet. It syncs when the connection returns.</Text> });
    const page = await screen.findByTestId('food-day-page');
    expect(within(page).getByTestId('pending')).toBeTruthy();
  });
});

describe('C_loading and the plan load error', () => {
  it('shows the Style C skeleton while the day or the plan is loading', async () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    await show();
    expect(screen.getByTestId('food-day-loading')).toBeTruthy();
    expect(screen.getByLabelText("Loading today's meals")).toBeTruthy();
    expect(screen.queryByText('Classic food log')).toBeNull();
  });

  it('falls back to the classic log with the retry when the plan cannot load', async () => {
    serve(timed, true);
    await show();
    expect(await screen.findByText('Your meal plan could not load. Check your connection, then try again.')).toBeTruthy();
    expect(screen.getByText('Classic food log')).toBeTruthy();
    expect(screen.queryByTestId('food-day-masthead')).toBeNull();
  });

  it('keeps the classic log when the day itself could not load', async () => {
    serve(timed);
    await show({ ready: false, dayLoading: false });
    expect(screen.getByText('Classic food log')).toBeTruthy();
  });
});

describe('coachless days: no coach, no Roman', () => {
  it('C_first: a day with nothing to build from opens on the first day page, every way to log one tap away', async () => {
    serve(timed);
    await show({ coached: false, foodLogs: [], eaten: { calories: 0, protein: 0 }, targets: null, nowMin: 8 * 60 + 20 });
    expect(await screen.findByText('Log what you eat today')).toBeTruthy();
    expect(screen.getByText('No target')).toBeTruthy();
    expect(screen.getByText('After a few days, this page builds your usual day from the meals you repeat.')).toBeTruthy();
    expect(screen.getAllByText('Nothing yet')).toHaveLength(3);
    await fireEvent.press(screen.getByLabelText('Enter manually'));
    expect(props.onSomethingElse).toHaveBeenLastCalledWith('breakfast');
    await fireEvent.press(screen.getByTestId('food-day-first-dinner'));
    expect(props.onSomethingElse).toHaveBeenLastCalledWith('dinner');
    expect(screen.queryByText(/Sam|Roman|plan for today/)).toBeNull();
    expect(mockGet).not.toHaveBeenCalledWith('/v1/clients/me/coach');
  });

  it('C_first: a food logged on the first day shows under its meal', async () => {
    serve(timed);
    await show({ coached: false, foodLogs: [log('5', 'lunch', 'Tomato soup', 210, '12:05')], eaten: { calories: 210, protein: 8 }, nowMin: 13 * 60 });
    const lunch = await screen.findByTestId('food-day-first-lunch');
    expect([within(lunch).getByText('Tomato soup'), within(lunch).getByText('12:05 pm')]).toBeTruthy();
    expect(screen.getAllByText('Nothing yet')).toHaveLength(2);
    expect(screen.getByText('1,640 kcal and 142 g protein left.')).toBeTruthy();
  });

  it('C_usual: the usual day has no coach note and no coach name', async () => {
    const entry = (id: string, name: string) => ({ meal_type: 'lunch', food_item_id: id, quantity_multiplier: 1, original_quantity: 1, original_unit: 'wrap',
      food_item: { id, name, calories_per_serving: 565, protein: 30, carbs: 50, fat: 15, nutrient_basis: 'PER_SERVING' } });
    mockDaily.mockImplementation(async (date: string) => ({ data: { entries: date < today ? [entry('wrap', 'Turkey and hummus wrap')] : [] } }));
    serve(timed);
    await show({ coached: false, foodLogs: [], eaten: { calories: 0, protein: 0 }, targets: { calories: 2000, protein: 120 } });
    expect(await screen.findByText('Your usual day')).toBeTruthy();
    expect(screen.getByText('Built from the meals you logged this week. 2,000 kcal target.')).toBeTruthy();
    expect(within(screen.getByTestId('food-day-next')).getByText('UP NEXT, YOUR USUAL LUNCH')).toBeTruthy();
    expect(screen.getByTestId('food-day-primary')).toBeTruthy();
    expect(screen.queryByText(/Sam|Roman|plan for today/)).toBeNull();
  });
});

describe('flag off', () => {
  it('reads as main: the classic log and no plan, coach, week or workout read', async () => {
    serve(timed);
    await show({ on: false });
    expect(screen.getByText('Classic food log')).toBeTruthy();
    expect(screen.queryByTestId('food-day-masthead')).toBeNull();
    await waitFor(() => expect(mockGet).not.toHaveBeenCalled());
    expect(mockDaily).not.toHaveBeenCalled();
  });
});
