// BEAUTY-930 (agent 197): the Style C day brought to its drawing (C2 Style C C_day, GOAL_MOCKUPS_170). The page keeps the
// app's #F7FAF7 (owner #197-E6: "#196-D13 - we keep the toothpaste color for v1"); the time gutter keeps "12:35 pm" on
// one line and grows with the text size; a food saved offline keeps main's dashed mark on the Style C timeline.
import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { getTodayString } from '../../../utils/date';
import { colors as palette } from '../../../theme/tokens';
import type { FoodLog } from '../../../types';

let mockScale = 1;
let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: mockScale }),
}));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) }, logApi: { getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: jest.fn() }));

type Flat = TextStyle & ViewStyle;
const flat = (node: { props: { style?: unknown } }): Flat => StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {};
const today = getTodayString();
const template = (name: string, kcal: number) => ({ name, calories_kcal: kcal, protein_g: 30, carbs_g: 20, fats_g: 5, items: [] });
const plan = {
  date: today, assignments: [{ daily_meal_plan: { id: 'p1', name: 'Lean week 2', notes: 'Protein at every meal. Water before coffee.', slots: [
    { id: 'b', slot_label: 'breakfast', order: 0, time_of_day: '07:30', meal_template: template('Greek yoghurt, oats and berries', 420) },
    { id: 'l', slot_label: 'lunch', order: 0, time_of_day: '12:30', meal_template: template('Chicken, rice and greens', 680) },
    { id: 'p', slot_label: 'preworkout', order: 0, time_of_day: '17:30', meal_template: template('Banana and whey shake', 250) },
  ] } }],
};
const log = (id: string, mealType: FoodLog['mealType'], foodName: string, calories: number, hhmm: string, planSlotId?: string,
  offline?: FoodLog['offline']): FoodLog => ({
  id, userId: 'u', coachId: 'c', date: today, mealType, foodName, calories, protein: 30, carbs: 10, fat: 5,
  quantity: 1, unit: 'serving', createdAt: `${today}T${hhmm}:00.000`, planSlotId, ...(offline ? { offline } : {}),
} as FoodLog);
const breakfast = log('1', 'breakfast', 'Greek yoghurt, oats and berries', 420, '07:40', 'b');
const lunch = log('3', 'lunch', 'Chicken, rice and greens', 680, '12:35', 'l');

async function show(foodLogs: FoodLog[] = [breakfast, lunch]) {
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) return { data: plan };
    if (url === '/v1/clients/me/coach') return { data: { name: 'Sam Reid' } };
    if (url === '/assignments/me') return { data: { items: [], nextCursor: null } };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached selectedDate={today} foodLogs={foodLogs} eaten={{ calories: 1100, protein: 75 }}
        targets={{ calories: 1850, protein: 150 }} ready saving={false} notes={null} water={<Text>Water card</Text>}
        nowMin={15 * 60 + 10} onDateChange={jest.fn()} onLogPlanned={jest.fn()} onRepeat={jest.fn()}
        onSomethingElse={jest.fn()} onEditFood={jest.fn()}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  await screen.findByText('Sam\'s plan for today');
}

beforeEach(() => { jest.clearAllMocks(); mockScale = 1; mockWidth = 390; });

describe('BEAUTY-930: the Style C day at its drawing', () => {
  it('keeps the app page colour (#F7FAF7) under the timeline, so the page and the screen behind it never show a seam', async () => {
    await show();
    expect(flat(screen.getByTestId('food-day-page')).backgroundColor).toBe(palette.bone);
    expect(palette.bone).toBe('#F7FAF7');
  });

  it.each([
    [1, 56],
    [1.3, 73],
    [2, 90], // capped at 1.6 x
  ])('at %s x text the time gutter is %s wide, so "12:35 pm" keeps one line', async (scale, width) => {
    mockScale = scale;
    await show();
    const time = screen.getByText('12:35 pm');
    expect(flat(time).width).toBe(width);
    expect(flat(time).fontSize).toBe(12);
  });

  it.each([
    [390, 1, 0],
    [320, 1.3, -(73 + 34)],
  ])('at %s wide and %s x text the up-next card sits under the body or takes the page width (margin %s)', async (w, scale, margin) => {
    mockWidth = w; mockScale = scale;
    await show();
    const card = screen.getByTestId('food-day-primary').parent;
    let node: typeof card | null = card;
    while (node && flat(node).backgroundColor !== palette.cream) node = node.parent;
    expect(node).toBeTruthy();
    expect(flat(node as NonNullable<typeof card>).marginLeft ?? 0).toBe(margin);
  });

  it('a food saved offline in a done meal keeps the dashed charcoal mark on the Style C timeline', async () => {
    await show([breakfast, lunch, log('9', 'snack', 'Banana and whey shake', 250, '15:05', 'p', 'waiting')]);
    const mark = flat(screen.getByTestId('food-day-waiting-p'));
    expect(mark.borderStyle).toBe('dashed');
    expect(mark.borderColor).toBe(palette.charcoal);
  });
});
