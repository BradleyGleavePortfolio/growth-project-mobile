import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import { getTodayString } from '../../../utils/date';
import type { FoodLog } from '../../../types';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
  logApi: { getDaily: jest.fn(async () => ({ data: { entries: [] } })) },
}));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ messageCoach: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

it('the enabled plan day visibly marks a waiting food instead of presenting it as synced', async () => {
  const today = getTodayString();
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) {
      return { data: { date: today, assignments: [{ daily_meal_plan: {
        id: 'plan', name: 'Daily meals', slots: [{
          id: 'breakfast-slot', slot_label: 'breakfast', order: 0,
          meal_template: { name: 'Rolled oats', calories_kcal: 150, protein_g: 5, carbs_g: 27, fats_g: 3, items: [] },
        }],
      } }] } };
    }
    if (url === '/v1/clients/me/coach') return { data: { name: 'Jordan Hale' } };
    throw new Error(`Unexpected request: ${url}`);
  });
  const waiting: FoodLog = {
    id: 'pfl-plan', clientUuid: 'pfl-plan', offline: 'waiting',
    userId: 'member-1', coachId: '', date: today, mealType: 'breakfast',
    planSlotId: 'breakfast-slot', foodName: 'Rolled oats',
    calories: 150, protein: 5, carbs: 27, fat: 3,
    quantity: 1, unit: 'serving', createdAt: `${today}T08:00:00.000`,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached selectedDate={today} foodLogs={[waiting]}
        eaten={{ calories: 150, protein: 5 }} targets={null} ready saving={false}
        notes={null} water={null} onDateChange={jest.fn()} onLogPlanned={jest.fn()}
        onRepeat={jest.fn()} onSomethingElse={jest.fn()} onEditFood={jest.fn()}>
        <Text>Classic log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  await fireEvent.press(await screen.findByTestId('food-day-slot-breakfast-slot'));
  expect(screen.queryByText('Classic log')).toBeNull();
  expect(screen.getAllByText('Rolled oats').length).toBeGreaterThan(0);
  expect(screen.getByText(/Saved offline/)).toBeTruthy();
});
