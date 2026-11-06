/**
 * LO-930R2 B2 B-TEST (m#930 @ 3989d064): on the first-day page (C_first) the now line must sit in clock order, as on
 * every other Style C day (C2 index: "a 24-hour timeline with a time gutter and a now line"; C_day draws the done
 * entries above the now line and what is still to eat under it). At the head the now row is drawn before every meal
 * (FoodDayView.tsx:288), so at 1:10 pm it shows above a breakfast eaten at 8:05 am.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../FoodDayView';
import type { FoodLog } from '../../../types';
import { getTodayString } from '../../../utils/date';

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

const today = getTodayString();
const oats: FoodLog = {
  id: 'oats', userId: 'user', coachId: '', date: today, mealType: 'breakfast',
  foodName: 'Rolled oats', calories: 300, protein: 10, carbs: 54, fat: 6,
  quantity: 1, unit: 'serving', createdAt: `${today}T08:05:00`,
};

/** testIDs in the order they are drawn (top to bottom). */
function drawnOrder(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((x) => drawnOrder(x, out)); return out; }
  const n = node as { props?: { testID?: string }; children?: unknown };
  if (n.props?.testID) out.push(n.props.testID);
  drawnOrder(n.children, out);
  return out;
}

it('LO-930R2 B2: C_first draws a meal eaten before now above the now line, and one still to eat under it', async () => {
  const noop = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <FoodDayGate on coached={false} selectedDate={today} nowMin={13 * 60 + 10}
        foodLogs={[oats]} eaten={{ calories: 300, protein: 10 }} targets={null}
        ready saving={false} notes={null} water={null} onDateChange={noop}
        onLogPlanned={noop} onRepeat={noop} onSomethingElse={noop} onEditFood={noop}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Log what you eat today')).toBeTruthy();
  const order = drawnOrder(screen.toJSON());
  const at = (id: string) => order.indexOf(id);
  expect(at('food-day-now')).toBeGreaterThan(-1);
  // 8:05 am breakfast is before 1:10 pm: above the now line.
  expect(at('food-day-first-breakfast')).toBeLessThan(at('food-day-now'));
  // Dinner, nothing yet: still to eat, under the now line.
  expect(at('food-day-first-dinner')).toBeGreaterThan(at('food-day-now'));
});
