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

// FIX-931 (LS-931 B2 as a class): every place the plan day draws a food marks one saved offline as
// waiting with the C2 Style C offline line, and a food the server refused shows, marked, and counts in
// nothing. The meal ring is the frame's dashed one while a food in it waits.
const today = getTodayString();
const food = (over: Partial<FoodLog>): FoodLog => ({
  id: 'x', userId: 'member-1', coachId: '', date: today, mealType: 'breakfast', foodName: 'Rolled oats',
  calories: 150, protein: 5, carbs: 27, fat: 3, quantity: 1, unit: 'serving', createdAt: `${today}T08:00:00.000`,
  ...over,
});

async function renderDay(foodLogs: FoodLog[], onEditFood = jest.fn()) {
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/me/meal-plan/today')) {
      return { data: { date: today, assignments: [{ daily_meal_plan: {
        id: 'plan', name: 'Daily meals', slots: [
          { id: 'breakfast-slot', slot_label: 'breakfast', order: 0,
            meal_template: { name: 'Rolled oats', calories_kcal: 150, protein_g: 5, carbs_g: 27, fats_g: 3, items: [] } },
          { id: 'lunch-slot', slot_label: 'lunch', order: 1,
            meal_template: { name: 'Chicken and rice', calories_kcal: 600, protein_g: 40, carbs_g: 60, fats_g: 15, items: [] } },
        ],
      } }] } };
    }
    if (url === '/v1/clients/me/coach') return { data: { name: 'Jordan Hale' } };
    throw new Error(`Unexpected request: ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached selectedDate={today} foodLogs={foodLogs}
        eaten={{ calories: 150, protein: 5 }} targets={null} ready saving={false}
        notes={null} water={null} onDateChange={jest.fn()} onLogPlanned={jest.fn()}
        onRepeat={jest.fn()} onSomethingElse={jest.fn()} onEditFood={onEditFood}>
        <Text>Classic log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  await screen.findByTestId('food-day-add');
}

it('a waiting plan meal reads with the drawn line under it and the dashed ring', async () => {
  await renderDay([food({ id: 'pfl-1', clientUuid: 'pfl-1', offline: 'waiting', planSlotId: 'breakfast-slot' })]);
  expect(screen.getByText('Saved offline. Rolled oats will sync when you reconnect.')).toBeTruthy();
  expect(screen.getByTestId('food-day-waiting-breakfast-slot')).toBeTruthy();
});

it('a synced plan meal keeps its status and its filled ring', async () => {
  await renderDay([food({ id: 'srv-1', planSlotId: 'breakfast-slot' })]);
  expect(screen.queryByText(/Saved offline/)).toBeNull();
  expect(screen.queryByTestId('food-day-waiting-breakfast-slot')).toBeNull();
});

it('a waiting extra carries the line in place of its meal', async () => {
  await renderDay([food({ id: 'pfl-2', clientUuid: 'pfl-2', offline: 'waiting', foodName: 'Flat white', mealType: 'snack' })]);
  expect(screen.getByText('Saved offline. Flat white will sync when you reconnect.')).toBeTruthy();
  expect(screen.queryByText('Logged to snack')).toBeNull();
});

it('a refused food shows with the extras, marked, with no number, and ticks off no meal', async () => {
  const onEditFood = jest.fn();
  const refused = food({ id: 'pfl-3', clientUuid: 'pfl-3', offline: 'refused', planSlotId: 'breakfast-slot' });
  await renderDay([refused], onEditFood);
  const row = screen.getByTestId('food-day-offline-pfl-3');
  expect(screen.getByText("Couldn't log food")).toBeTruthy();
  expect(screen.queryByText('150')).toBeNull();
  // The breakfast meal is still to eat: it is the up-next card, not a done row.
  expect(screen.queryByTestId('food-day-waiting-breakfast-slot')).toBeNull();
  await fireEvent.press(row);
  expect(onEditFood).toHaveBeenCalledWith(refused);
});
