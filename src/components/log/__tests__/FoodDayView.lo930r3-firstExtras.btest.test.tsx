/**
 * LO-930R3 B1 (B-TEST, review only, never merge): a first day (C_first) has no plan, so a food outside its three
 * meals (a snack) must not be headed "EXTRAS, NOT IN THE PLAN". The plan and usual days already choose the words
 * by isPlan (FoodDayView.tsx:427); the first day calls extraRow with no plan argument (:336), so it takes the
 * plan = true default (:538, :552). The date is today's, so the test does not depend on the day it runs.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { getTodayString } from '../../../utils/date';
import type { FoodLog } from '../../../types';

const today = getTodayString();
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

const food = (mealType: FoodLog['mealType'], time: string, foodName: string): FoodLog => ({
  id: `${mealType}-${time}`, userId: 'user', coachId: '', date: today, mealType, foodName,
  calories: 100, protein: 5, carbs: 10, fat: 3, quantity: 1, unit: 'serving',
  createdAt: `${today}T${time}:00`,
});

it.each([false, true])('LO-930R3 B1: a first-day snack is not called "not in the plan", coached=%s', async (coached) => {
  const noop = jest.fn();
  await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FoodDayGate on coached={coached} selectedDate={today} nowMin={21 * 60}
        foodLogs={[food('breakfast', '08:05', 'Rolled oats'), food('snack', '15:30', 'Apple')]}
        eaten={{ calories: 200, protein: 10 }} targets={null} ready saving={false}
        notes={null} water={null} onDateChange={noop} onLogPlanned={noop} onRepeat={noop}
        onSomethingElse={noop} onEditFood={noop}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  await screen.findByText('Log what you eat today');
  const snack = screen.getByTestId('food-day-extra-snack-15:30');
  expect(within(snack).getByText('Apple')).toBeTruthy();
  expect(screen.queryByText(/NOT IN THE PLAN/i)).toBeNull();
  expect(within(snack).getByText('EXTRAS')).toBeTruthy();
});
