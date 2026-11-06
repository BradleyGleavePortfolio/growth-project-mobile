// LS-930R3 B1: meal-completion segments represent meals logged, not calories.
// A target exceeded by an extra does not complete any untouched plan/usual meal.
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { gold } from '../../../theme/tokens';
import type { FoodLog } from '../../../types';

const DAY = '2026-11-05';
const mockGet = jest.fn();
const mockDaily = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) },
  logApi: { getDaily: (...a: unknown[]) => mockDaily(...a) },
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: jest.fn() }) }));

beforeAll(() => {
  jest.useFakeTimers({ now: new Date(`${DAY}T12:00:00`), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
});
afterAll(() => jest.useRealTimers());
const food = (id: string, mealType: FoodLog['mealType'], calories: number, linked = false): FoodLog => ({
  id, userId: 'user', coachId: '', date: DAY, mealType, foodName: id,
  calories, protein: 5, carbs: 10, fat: 3, quantity: 1, unit: 'serving',
  createdAt: `${DAY}T08:00:00`,
  ...(linked ? { planSlotId: 'breakfast', fillsUsualMeal: true } : {}),
});
const plan = {
  assignments: [{ daily_meal_plan: { id: 'p', name: 'Day plan', slots: ['breakfast', 'lunch', 'dinner'].map((meal) => ({
    id: meal, slot_label: meal, order: 0,
    meal_template: { name: meal, calories_kcal: 100, protein_g: 5, carbs_g: 10, fats_g: 3, items: [] },
  })) } }],
};
const past = ['breakfast', 'lunch', 'dinner'].map((meal) => ({
  meal_type: meal, food_item_id: meal, quantity_multiplier: 1, original_quantity: 1, original_unit: 'serving',
  food_item: { id: meal, name: meal, calories_per_serving: 100, nutrient_basis: 'PER_SERVING' },
}));
type Node = ReturnType<typeof screen.getByTestId>;
const descendants = (node: Node): Node[] => [node, ...node.children.flatMap((child) =>
  typeof child === 'string' ? [] : descendants(child))];

it.each([
  [true, false, 0], [true, false, 1], [true, true, 0], [true, true, 1],
  [false, false, 0], [false, false, 1], [false, true, 0], [false, true, 1],
] as const)('LS-930R3 B1: coached=%s over=%s mealsDone=%s, only logged meals have filled completion marks',
  async (coached, over, mealsDone) => {
    mockGet.mockImplementation(async (url: string) => ({
      data: url.startsWith('/assignments/me') ? { items: [], nextCursor: null }
        : url.startsWith('/me/meal-plan/today') ? plan : { name: 'Sam' },
    }));
    mockDaily.mockResolvedValue({ data: { entries: past } });
    const logs = [food('Snack', 'snack', over ? 500 : 50),
      ...(mealsDone ? [food('Breakfast', 'breakfast', 100, true)] : [])];
    const noop = jest.fn();
    await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FoodDayGate on coached={coached} selectedDate={DAY} nowMin={780} foodLogs={logs}
          eaten={{ calories: logs.reduce((n, l) => n + l.calories, 0), protein: 10 }}
          targets={{ calories: 400, protein: 100 }} ready saving={false} notes={null} water={null}
          onDateChange={noop} onLogPlanned={noop} onRepeat={noop} onSomethingElse={noop} onEditFood={noop}>
          <Text>Classic</Text>
        </FoodDayGate>
      </QueryClientProvider>,
    );
    const masthead = await screen.findByTestId('food-day-masthead');
    const progress = descendants(masthead).find((node) =>
      node.props.accessibilityElementsHidden && node.props.importantForAccessibility === 'no-hide-descendants');
    expect(progress).toBeDefined();
    const fills = progress!.children.filter((child) => typeof child !== 'string'
      && StyleSheet.flatten(child.props.style)?.backgroundColor === gold[300]);
    expect(fills).toHaveLength(mealsDone);
    // This state really still has an uneaten next meal. Exceeding calories must not conceal that fact in the marks.
    expect(screen.getByTestId('food-day-next')).toBeTruthy();
  });
