import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: async (url: string) => ({
      data: url.startsWith('/assignments/me')
        ? { items: [], nextCursor: null }
        : url.startsWith('/me/meal-plan/today') ? { assignments: [] } : { name: 'Sam' },
    }),
  },
  logApi: { getDaily: async () => ({ data: { entries: [] } }) },
}));

// FIX-930R2 (LO-930R2 B1): a fixed clock, never the real date. The first day (C_first) shows only on today, so the
// clock is pinned to the fixtures' 2026-11-05 (local noon); only Date is faked, timers stay real.
beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-11-05T12:00:00'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
});
afterAll(() => jest.useRealTimers());

it.each([false, true])('LS-930 B1: first day keeps a real target when above it, coached=%s', async (coached) => {
  const noop = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached={coached} selectedDate="2026-11-05" nowMin={900}
        foodLogs={[{
          id: 'dinner', userId: 'user', coachId: '', date: '2026-11-05', mealType: 'dinner',
          foodName: 'Dinner', calories: 1950, protein: 110, carbs: 200, fat: 75,
          quantity: 1, unit: 'serving', createdAt: '2026-11-05T18:00:00',
        }]} eaten={{ calories: 1950, protein: 110 }} targets={{ calories: 1850, protein: 150 }}
        ready saving={false} notes={null} water={null} onDateChange={noop}
        onLogPlanned={noop} onRepeat={noop} onSomethingElse={noop} onEditFood={noop}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Log what you eat today')).toBeTruthy();
  expect(screen.queryByText('No target')).toBeNull();
  expect(screen.getByText("100 kcal above today's target. Protein 110 of 150 g.")).toBeTruthy();
});
