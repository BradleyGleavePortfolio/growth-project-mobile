/**
 * FIX-930R2 class tests (LO-930R2 B1/B2, LS-930R2 B1/B2):
 * - every first-day tile opens the right thing: Search foods and the now line's Add open search, Enter manually
 *   opens the manual form, each for the next meal with nothing yet; a meal row with nothing yet opens search for it;
 * - the first day is in clock order like every other day: eaten meals above the now line at their time, meals
 *   with nothing yet under it in Breakfast, Lunch, Dinner order, other foods at their time, and the day's workout.
 * The clock is fixed (LO-930R2 B1): the first day shows only on today.
 */
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import type { FoodLog } from '../../../types';

const TODAY = '2026-11-05';
beforeAll(() => {
  jest.useFakeTimers({ now: new Date(`${TODAY}T12:00:00`), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
});
afterAll(() => jest.useRealTimers());

let mockWorkouts: unknown[] = [];
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: async (url: string) => ({
      data: url.startsWith('/assignments/me') ? { items: mockWorkouts, nextCursor: null }
        : url.startsWith('/me/meal-plan/today') ? { assignments: [] } : { name: 'Sam' },
    }),
  },
  logApi: { getDaily: async () => ({ data: { entries: [] } }) },
}));

const food = (mealType: FoodLog['mealType'], time: string, id: string = mealType): FoodLog => ({
  id, userId: 'user', coachId: '', date: TODAY, mealType, foodName: id,
  calories: 100, protein: 5, carbs: 10, fat: 3, quantity: 1, unit: 'serving',
  createdAt: `${TODAY}T${time}:00`,
});

async function show(foodLogs: FoodLog[], nowMin: number, coached = false) {
  const onSomethingElse = jest.fn();
  const onEditFood = jest.fn();
  const noop = jest.fn();
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FoodDayGate on coached={coached} selectedDate={TODAY} nowMin={nowMin} foodLogs={foodLogs}
        eaten={{ calories: 100, protein: 5 }} targets={null} ready saving={false}
        notes={null} water={null} onDateChange={noop} onLogPlanned={noop} onRepeat={noop}
        onSomethingElse={onSomethingElse} onEditFood={onEditFood}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  await screen.findByTestId('food-day-first-breakfast');
  return { onSomethingElse, onEditFood };
}

const order = () => screen.getAllByTestId(/^food-day-(first-(breakfast|lunch|dinner)|now|workout|extra-.+)$/)
  .map((n) => String(n.props.testID).replace(/^food-day-(first-)?/, ''));

beforeEach(() => { mockWorkouts = []; });

describe('FIX-930R2 every first-day tile opens the right thing', () => {
  it.each([
    // [state, tile, expected call]
    ['nothing logged', 'food-day-first-search', ['breakfast']],
    ['nothing logged', 'food-day-add', ['breakfast']],
    ['nothing logged', 'food-day-first-manual', ['breakfast', undefined, true]],
    ['nothing logged', 'food-day-first-lunch', ['lunch']],
    ['breakfast logged', 'food-day-first-search', ['lunch']],
    ['breakfast logged', 'food-day-add', ['lunch']],
    ['breakfast logged', 'food-day-first-manual', ['lunch', undefined, true]],
    ['breakfast logged', 'food-day-first-dinner', ['dinner']],
  ] as const)('%s: %s', async (state, tile, call) => {
    const { onSomethingElse, onEditFood } = await show(state === 'breakfast logged' ? [food('breakfast', '08:05')] : [], 13 * 60);
    await fireEvent.press(screen.getByTestId(tile));
    expect(onSomethingElse).toHaveBeenCalledTimes(1);
    expect(onSomethingElse).toHaveBeenLastCalledWith(...call);
    expect(onEditFood).not.toHaveBeenCalled();
  });

  it('a first-day meal with one food opens its edit sheet, not search', async () => {
    const oats = food('breakfast', '08:05', 'Oats');
    const { onSomethingElse, onEditFood } = await show([oats], 13 * 60);
    await fireEvent.press(screen.getByTestId('food-day-first-breakfast'));
    expect(onEditFood).toHaveBeenLastCalledWith(oats);
    expect(onSomethingElse).not.toHaveBeenCalled();
  });
});

describe('FIX-930R2 the first day is in clock order', () => {
  it.each([
    ['nothing logged, 8:20 am', [], 8 * 60 + 20, ['now', 'breakfast', 'lunch', 'dinner']],
    ['breakfast at 8:05, 1:00 pm', [food('breakfast', '08:05')], 13 * 60, ['breakfast', 'now', 'lunch', 'dinner']],
    ['breakfast and lunch, 1:00 pm', [food('breakfast', '08:05'), food('lunch', '12:40')], 13 * 60,
      ['breakfast', 'lunch', 'now', 'dinner']],
    ['all three, 9:00 pm', [food('breakfast', '08:05'), food('lunch', '12:40'), food('dinner', '19:10')], 21 * 60,
      ['breakfast', 'lunch', 'dinner', 'now']],
    ['a snack at 10:30 between meals', [food('breakfast', '08:05'), food('snack', '10:30', 'Apple'), food('lunch', '12:40')],
      13 * 60, ['breakfast', 'extra-Apple', 'lunch', 'now', 'dinner']],
  ] as const)('%s', async (_name, logs, nowMin, expected) => {
    await show([...logs], nowMin);
    expect(order()).toEqual(expected);
  });

  it("the day's workout from Train sits on the first day at its time", async () => {
    mockWorkouts = [{ id: 'workout', scheduled_for: TODAY, scheduled_time: '18:00', completed_at: null,
      workout_plan: { name: 'Upper body' } }];
    await show([food('breakfast', '08:05')], 13 * 60, true);
    await screen.findByTestId('food-day-workout');
    expect(order()).toEqual(['breakfast', 'now', 'lunch', 'dinner', 'workout']);
    expect(screen.getByTestId('food-day-workout')).toHaveTextContent(/Upper body/);
  });
});
