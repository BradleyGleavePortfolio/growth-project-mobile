// FOODLINK durability (Sol B1 / Opus B1 at m#700 bd2c3712): an offline "Something else" food goes through the real
// persisted queue, its flush, the server's snake-case day row and the real day-store mapping, and its plan meal is
// still done in a fresh view and cache. Only storage (the AsyncStorage jest mock) and the network (api) are faked.
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FoodDayGate } from '../../../components/log/FoodDayView';
import { flush, getQueueLength } from '../../../services/foodLogQueue';
import { useClientStore } from '../../../store/clientStore';
import { getTodayString } from '../../date';
import { submitManualLogOffline, submitSearchLogOffline } from '../logSubmit';
import type { SearchResult } from '../types';

const mockFlags = { foodPlanChecklist: true };
jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, featureFlags: new Proxy(real.featureFlags, { get: (t, k) => (k in mockFlags ? mockFlags[k as 'foodPlanChecklist'] : (t as Record<string | symbol, unknown>)[k]) }) };
});
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client' }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

// A fake server: it keeps what POST /log/food sends (as the backend does for the caller's own slot) and answers
// GET /log/daily with the stored rows in the backend's snake-case shape.
const today = getTodayString();
const mockFoods: Record<string, Record<string, unknown>> = { cat: { id: 'cat', name: 'Overnight oats', calories: 390, protein_g: 28 } };
const mockRows: Array<Record<string, unknown>> = [];
const mockPlan = { date: today, assignments: [{ daily_meal_plan: { id: 'p', name: 'Lean week', notes: null, slots: [
  { id: 'b', slot_label: 'breakfast', order: 0, meal_template: { id: 't1', name: 'Overnight oats', calories_kcal: 390, protein_g: 28, carbs_g: 52, fats_g: 9, items: [] } },
  { id: 's', slot_label: 'snack', order: 0, meal_template: { id: 't2', name: 'Greek yogurt', calories_kcal: 210, protein_g: 20, carbs_g: 12, fats_g: 6, items: [] } },
] } }] };
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: async (url: string) => ({ data: url.startsWith('/me/meal-plan/today') ? mockPlan : { name: 'Jordan Hale' } }) },
  foodApi: { create: async (food: Record<string, unknown>) => {
    const id = `food-${Object.keys(mockFoods).length}`;
    mockFoods[id] = { id, ...food };
    return { data: { id } };
  } },
  logApi: {
    logFood: async (body: Record<string, unknown>) => {
      const row = { id: `entry-${mockRows.length + 1}`, user_id: 'client', created_at: `${body.date}T08:00:00.000Z`, plan_slot_id: null, fills_usual_meal: false, ...body };
      mockRows.push(row);
      return { data: row };
    },
    getDaily: async (date: string) => ({ data: { entries: mockRows.filter((r) => r.date === date)
      .map((r) => ({ ...r, food_item: mockFoods[r.food_item_id as string] })) } }),
  },
  waterApi: { getDaily: async () => ({ data: { total_ml: 0, logs: [] } }) },
}));

const noop = () => undefined;
async function relaunchAndShow() {
  // Nothing from the last session but the server: a fresh day store and a fresh query cache.
  useClientStore.getState().reset();
  await useClientStore.getState().loadDayData('client', today);
  const { foodLogs } = useClientStore.getState();
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FoodDayGate on coached selectedDate={today} foodLogs={foodLogs} eaten={{ calories: 810, protein: 52 }}
        targets={{ calories: 1200, protein: 100 }} ready saving={false} notes={null} water={null}
        onDateChange={noop} onLogPlanned={noop} onRepeat={noop} onSomethingElse={noop} onEditFood={noop}>
        <Text>Classic food log</Text>
      </FoodDayGate>
    </QueryClientProvider>,
  );
}

it('keeps an offline Something else meal done through the queue, a relaunch, the server row and a sign-in again', async () => {
  await AsyncStorage.clear();
  // Offline: "Something else" for breakfast (the sheet's manual entry, linked), then the plan meal's own name
  // through Extras "Add" (no link).
  await submitManualLogOffline({ foodName: 'Eggs on toast', calories: '420', protein: '24', carbs: '30', fat: '18',
    quantity: '1', unit: 'serving', date: today, mealType: 'breakfast', link: { planSlotId: 'b' } });
  await submitSearchLogOffline({ food: { id: 'cat', name: 'Overnight oats' } as SearchResult, date: today, mealType: 'breakfast', multiplier: 1 });
  expect(await AsyncStorage.getItem('pending_food_logs_client')).toContain('"plan_slot_id":"b"');

  // Relaunch, back online: the stored queue flushes, then the day is read back from the server.
  await flush();
  expect(await getQueueLength()).toBe(0);
  expect(mockRows.map((r) => r.plan_slot_id)).toEqual(['b', null]);
  const first = await relaunchAndShow();
  expect(useClientStore.getState().foodLogs.map((l) => l.planSlotId)).toEqual(['b', undefined]);
  expect(await screen.findByText('Logged with a change: Eggs on toast')).toBeTruthy();
  expect(screen.getByText('1 of 2 meals done')).toBeTruthy();
  expect(screen.getByLabelText('Overnight oats, logged to breakfast, 390 kcal')).toBeTruthy();
  await first.unmount();

  // Sign out and in, a cleared cache or another phone: the phone's storage is empty, the server row is not.
  await AsyncStorage.clear();
  await relaunchAndShow();
  expect(await screen.findByText('Logged with a change: Eggs on toast')).toBeTruthy();
  expect(screen.getByText('UP NEXT, SNACK')).toBeTruthy();
});
