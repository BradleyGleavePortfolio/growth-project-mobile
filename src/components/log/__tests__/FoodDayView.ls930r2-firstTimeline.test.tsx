import React from 'react';
import { Text } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { getTodayString } from '../../../utils/date';
import type { FoodLog } from '../../../types';

const today = getTodayString();
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

const food = (mealType: FoodLog['mealType'], time: string): FoodLog => ({
  id: mealType, userId: 'user', coachId: '', date: today, mealType, foodName: mealType,
  calories: 100, protein: 5, carbs: 10, fat: 3, quantity: 1, unit: 'serving',
  createdAt: `${today}T${time}:00`,
});

async function show(coached: boolean, foodLogs: FoodLog[], nowMin = 13 * 60) {
  const noop = jest.fn();
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FoodDayGate on coached={coached} selectedDate={today} nowMin={nowMin} foodLogs={foodLogs}
        eaten={{ calories: 100, protein: 5 }} targets={null} ready saving={false}
        notes={null} water={null} onDateChange={noop} onLogPlanned={noop} onRepeat={noop}
        onSomethingElse={noop} onEditFood={noop}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  await screen.findByText('Log what you eat today');
}

beforeEach(() => { mockWorkouts = []; });

it.each([false, true])('LS-930R2 B1: first-day past meals precede the now line, coached=%s', async (coached) => {
  await show(coached, [food('breakfast', '08:05'), food('lunch', '12:40')]);
  const order = screen.getAllByTestId(/^food-day-(first-(breakfast|lunch|dinner)|now)$/)
    .map((node) => node.props.testID);
  expect(order).toEqual([
    'food-day-first-breakfast', 'food-day-first-lunch', 'food-day-now', 'food-day-first-dinner',
  ]);
});

it('LS-930R2 B1: first-day scheduled workout remains on the Food timeline without a meal plan', async () => {
  mockWorkouts = [{
    id: 'workout', scheduled_for: today, scheduled_time: '18:00', completed_at: null,
    workout_plan: { name: 'Full body A' },
  }];
  await show(true, []);
  const workout = await screen.findByTestId('food-day-workout');
  expect(within(workout).getByText('Full body A')).toBeTruthy();
  expect(within(workout).getByText('6:00 pm')).toBeTruthy();
});
