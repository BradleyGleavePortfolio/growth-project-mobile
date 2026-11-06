// FIX-930R1 (class-first, LS-930 B1 + B2 / LO-930 B1): the first day (C_first) keeps the masthead's target line
// in every target state, and every first-day meal reaches each of its foods.
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import type { FoodLog } from '../../../types';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: async (url: string) => ({
      data: url.startsWith('/assignments/me') ? { items: [], nextCursor: null }
        : url.startsWith('/me/meal-plan/today') ? { assignments: [] } : { name: 'Sam' },
    }),
  },
  logApi: { getDaily: async () => ({ data: { entries: [] } }) },
}));

const food = (id: string, foodName: string, calories: number, extra: Partial<FoodLog> = {}): FoodLog => ({
  id, userId: 'user', coachId: '', date: '2026-11-05', mealType: 'breakfast', foodName, calories,
  protein: 5, carbs: 20, fat: 3, quantity: 1, unit: 'serving', createdAt: '2026-11-05T08:00:00', ...extra,
});
// FIX-930R2 (LO-930R2 B1): a fixed clock, never the real date. The first day (C_first) shows only on today, so the
// clock is pinned to the fixtures' 2026-11-05 (local noon); only Date is faked, timers stay real.
beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-11-05T12:00:00'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
});
afterAll(() => jest.useRealTimers());

const props = { onDateChange: jest.fn(), onLogPlanned: jest.fn(), onRepeat: jest.fn(), onSomethingElse: jest.fn(), onEditFood: jest.fn() };
async function show(o: { coached?: boolean; foodLogs?: FoodLog[]; eaten?: { calories: number; protein: number };
  targets?: { calories: number; protein: number } | null }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached={o.coached ?? false} selectedDate="2026-11-05" nowMin={900} foodLogs={o.foodLogs ?? []}
        eaten={o.eaten ?? { calories: 0, protein: 0 }} targets={o.targets ?? null} ready saving={false} notes={null}
        water={null} {...props}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Log what you eat today')).toBeTruthy();
}

beforeEach(() => jest.clearAllMocks());

describe('FIX-930R1 B1 class: the first-day masthead line in every target state', () => {
  it.each([
    [false, null, 'No target'],
    [true, null, 'No target'],
    [false, { calories: 0, protein: 0 }, 'No target'],
    [false, { calories: 1850, protein: 150 }, '900 kcal and 100 g protein left.'],
    [true, { calories: 1850, protein: 150 }, '900 kcal and 100 g protein left.'],
    [false, { calories: 950, protein: 40 }, "0 kcal and 0 g protein left."],
    [false, { calories: 800, protein: 60 }, "150 kcal above today's target. Protein 50 of 60 g."],
    [true, { calories: 800, protein: 60 }, "150 kcal above today's target. Protein 50 of 60 g."],
  ] as const)('coached=%s, targets %j: %s', async (coached, targets, line) => {
    await show({ coached, targets, eaten: { calories: 950, protein: 50 }, foodLogs: [food('a', 'Rolled oats', 950)] });
    expect(screen.getByText(line)).toBeTruthy();
    if (line !== 'No target') expect(screen.queryByText('No target')).toBeNull();
  });
});

describe('FIX-930R1 B2 class: every first-day meal reaches each of its foods', () => {
  const oats = food('oats', 'Rolled oats', 150);
  const milk = food('milk', 'Milk', 100, { createdAt: '2026-11-05T08:01:00' });
  const berries = food('berries', 'Blueberries', 40, { offline: 'waiting', createdAt: '2026-11-05T08:02:00' } as Partial<FoodLog>);
  const soup = food('soup', 'Tomato soup', 210, { mealType: 'lunch', createdAt: '2026-11-05T12:30:00' });
  const bread = food('bread', 'Bread roll', 160, { mealType: 'lunch', createdAt: '2026-11-05T12:31:00' });

  it('nothing yet: the row opens the search sheet for that meal', async () => {
    await show({});
    await fireEvent.press(screen.getByTestId('food-day-first-dinner'));
    expect(props.onSomethingElse).toHaveBeenCalledWith('dinner');
    expect(props.onEditFood).not.toHaveBeenCalled();
  });

  it('one food: the row opens that food\'s edit sheet', async () => {
    await show({ foodLogs: [oats] });
    await fireEvent.press(screen.getByTestId('food-day-first-breakfast'));
    expect(props.onEditFood).toHaveBeenCalledWith(oats);
    expect(props.onSomethingElse).not.toHaveBeenCalled();
  });

  it.each([
    ['breakfast, two foods', 'breakfast', [oats, milk]],
    ['breakfast, three foods, one waiting to sync', 'breakfast', [oats, milk, berries]],
    ['lunch, two foods', 'lunch', [soup, bread]],
  ] as const)('%s: the row opens one row per food, each to its own edit sheet', async (_name, meal, logs) => {
    await show({ foodLogs: [...logs] });
    const row = screen.getByTestId(`food-day-first-${meal}`);
    expect(row.props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(row);
    expect(props.onSomethingElse).not.toHaveBeenCalled();
    expect(screen.getByTestId(`food-day-first-${meal}`).props.accessibilityState).toEqual({ expanded: true });
    for (const l of logs) {
      await fireEvent.press(screen.getByLabelText(`${l.foodName}, ${l.calories} kcal${l.offline ? '. Saved offline' : ''}`));
      expect(props.onEditFood).toHaveBeenLastCalledWith(l);
    }
    // A second tap folds the meal again.
    await fireEvent.press(screen.getByTestId(`food-day-first-${meal}`));
    expect(screen.queryByLabelText(`${logs[0].foodName}, ${logs[0].calories} kcal`)).toBeNull();
  });
});
