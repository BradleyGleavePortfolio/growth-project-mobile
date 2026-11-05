import React from 'react';
import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import type { FoodLog } from '../../../types';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: async (url: string) => ({
      data: url.startsWith('/assignments/me') ? { items: [], nextCursor: null } : { assignments: [] },
    }),
  },
  logApi: { getDaily: async () => ({ data: { entries: [] } }) },
}));

const oats: FoodLog = {
  id: 'oats', userId: 'user', coachId: '', date: '2026-11-05', mealType: 'breakfast',
  foodName: 'Rolled oats', calories: 150, protein: 5, carbs: 27, fat: 3,
  quantity: 1, unit: 'serving', createdAt: '2026-11-05T08:00:00',
};
const milk: FoodLog = { ...oats, id: 'milk', foodName: 'Milk', calories: 100 };

it('LS-930 B2: first-day meals with two foods still expose each food for edit, move or delete', async () => {
  const noop = jest.fn();
  const onEditFood = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached={false} selectedDate="2026-11-05" nowMin={900}
        foodLogs={[oats, milk]} eaten={{ calories: 250, protein: 10 }} targets={null}
        ready saving={false} notes={null} water={null} onDateChange={noop}
        onLogPlanned={noop} onRepeat={noop} onSomethingElse={noop} onEditFood={onEditFood}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Log what you eat today')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('food-day-first-breakfast'));
  // Like a completed planned meal, its row must lead to the individual foods,
  // not silently open Add Food and make the existing entries unreachable.
  expect(noop).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Rolled oats, 150 kcal'));
  expect(onEditFood).toHaveBeenLastCalledWith(oats);
  await fireEvent.press(screen.getByLabelText('Milk, 100 kcal'));
  expect(onEditFood).toHaveBeenLastCalledWith(milk);
});
