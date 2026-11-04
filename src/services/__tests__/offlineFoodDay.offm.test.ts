// OFFLINE-FOOD-M (owner #191-E3): a food saved with no signal counts in its day at once, marked
// "Saved offline", and is replaced by the server's entry on sync: never counted twice (the join is
// the save's key, client_uuid, which b#1209's resend rule reads), never lost (a refused food stays
// in the day, marked, in no total). Runs against the real queue, sync and store with a fake server.
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, offlineFoodInDay: true } };
});

const mockUser = { id: 'member-1' as string | undefined };
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => (mockUser.id ? { id: mockUser.id } : null)),
}));

type Entry = { id: string; client_uuid: string; food_item_id: string; meal_type: string; quantity_multiplier: number; date: string };
const mockServer = {
  entries: [] as Entry[],
  // A send the server stores but whose answer never reaches the phone.
  loseAnswer: false,
  // A send the server refuses (400): the queue parks it.
  refuse: false,
  // A send held open, to read the day while it is in flight (a slow sync).
  hold: null as null | Promise<void>,
  readFails: false,
};
const FOODS: Record<string, { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }> = {
  'food-oats': { name: 'Rolled oats', calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3 },
  'food-milk': { name: 'Milk', calories: 100, protein_g: 8, carbs_g: 12, fat_g: 2 },
  'food-egg': { name: 'Egg', calories: 70, protein_g: 6, carbs_g: 0, fat_g: 5 },
};

jest.mock('../api', () => ({
  foodApi: { create: jest.fn() },
  waterApi: { getDaily: jest.fn(async () => ({ data: { total_oz: 0, entries: [] } })) },
  logApi: {
    logFood: jest.fn(async (body: { client_uuid: string; food_item_id: string; meal_type: string; quantity_multiplier: number; date: string }) => {
      if (mockServer.hold) await mockServer.hold;
      if (mockServer.refuse) throw Object.assign(new Error('refused'), { response: { status: 400 } });
      // b#1209: a resend of a key the server holds answers with that entry; never a second row.
      let entry = mockServer.entries.find((e) => e.client_uuid === body.client_uuid);
      if (!entry) {
        entry = { id: `srv-${mockServer.entries.length + 1}`, ...body };
        mockServer.entries.push(entry);
      }
      if (mockServer.loseAnswer) throw new Error('Network Error');
      return { data: entry };
    }),
    getDaily: jest.fn(async (date: string) => {
      if (mockServer.readFails) throw new Error('Network Error');
      const entries = mockServer.entries
        .filter((e) => e.date === date)
        .map((e) => ({ ...e, user_id: 'member-1', food_item: { id: e.food_item_id, ...FOODS[e.food_item_id] } }));
      const sum = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') =>
        entries.reduce((s, e) => s + Math.round(FOODS[e.food_item_id][k] * e.quantity_multiplier), 0);
      return {
        data: { entries, total_calories: sum('calories'), total_protein_g: sum('protein_g'), total_carbs_g: sum('carbs_g'), total_fat_g: sum('fat_g') },
      };
    }),
  },
}));

import { useClientStore } from '../../store/clientStore';
import { notifyPendingFoodLogs, syncFoodLogQueue } from '../foodLogSync';
import { getQueueLength } from '../foodLogQueue';
import { submitSearchLogOffline } from '../../utils/log/logSubmit';
import type { SearchResult } from '../../utils/log/types';

const DAY = '2026-11-04';
const oats = { id: 'food-oats', name: 'Rolled oats', calories: 150, protein: 5, carbs: 27, fat: 3 } as unknown as SearchResult;

async function saveOatsOffline() {
  await submitSearchLogOffline({ food: oats, date: DAY, mealType: 'breakfast', multiplier: 1, originalQuantity: 1, originalUnit: 'serving' });
  await notifyPendingFoodLogs();
}
const day = () => useClientStore.getState();
const oatsRows = () => day().foodLogs.filter((f) => f.foodName === 'Rolled oats');

beforeEach(async () => {
  await AsyncStorage.clear();
  mockServer.entries = [{ id: 'srv-0', client_uuid: 'k-egg', food_item_id: 'food-egg', meal_type: 'breakfast', quantity_multiplier: 1, date: DAY }];
  mockServer.loseAnswer = false;
  mockServer.refuse = false;
  mockServer.hold = null;
  mockServer.readFails = false;
  mockUser.id = 'member-1';
  useClientStore.getState().reset();
  useClientStore.getState().setSelectedDate(DAY);
  await useClientStore.getState().loadDayData('member-1', DAY);
});

describe('OFFLINE-FOOD-M: a food saved offline counts in its day at once', () => {
  it('shows in the day, marked waiting, and adds to the totals at once', async () => {
    expect(day().dailyTotals.calories).toBe(70);
    await saveOatsOffline();
    expect(oatsRows()).toHaveLength(1);
    expect(oatsRows()[0].offline).toBe('waiting');
    expect(day().dailyTotals).toEqual({ calories: 220, protein: 11, carbs: 27, fat: 8 });
  });

  it('is still counted after the day is read again (a cold start with the food still queued)', async () => {
    await saveOatsOffline();
    useClientStore.getState().reset();
    useClientStore.getState().setSelectedDate(DAY);
    await useClientStore.getState().loadDayData('member-1', DAY);
    expect(oatsRows()).toHaveLength(1);
    expect(day().dailyTotals.calories).toBe(220);
  });

  it('sync replaces it with the server entry, counted once', async () => {
    await saveOatsOffline();
    expect(oatsRows().map((r) => r.offline)).toEqual(['waiting']);
    await syncFoodLogQueue();
    expect(mockServer.entries.filter((e) => e.food_item_id === 'food-oats')).toHaveLength(1);
    expect(oatsRows()).toHaveLength(1);
    expect(oatsRows()[0].offline).toBeUndefined();
    expect(day().dailyTotals.calories).toBe(220);
    expect(await getQueueLength()).toBe(0);
  });

  it('the save reached the server but the answer was lost: counted once, then the resend stores nothing new', async () => {
    await saveOatsOffline();
    expect(oatsRows().map((r) => r.offline)).toEqual(['waiting']);
    mockServer.loseAnswer = true;
    await syncFoodLogQueue();
    // The server holds it; the phone still queues it. A read of the day joins the two on the key.
    expect(await getQueueLength()).toBe(1);
    await useClientStore.getState().loadDayData('member-1', DAY);
    expect(oatsRows()).toHaveLength(1);
    expect(oatsRows()[0].offline).toBeUndefined();
    expect(day().dailyTotals.calories).toBe(220);
    mockServer.loseAnswer = false;
    await syncFoodLogQueue();
    expect(mockServer.entries.filter((e) => e.food_item_id === 'food-oats')).toHaveLength(1);
    expect(await getQueueLength()).toBe(0);
    expect(oatsRows()).toHaveLength(1);
    expect(day().dailyTotals.calories).toBe(220);
  });

  it('a slow sync: the day read while the send is in flight counts it once, before and after', async () => {
    await saveOatsOffline();
    let release: () => void = () => undefined;
    mockServer.hold = new Promise<void>((r) => { release = r; });
    const sync = syncFoodLogQueue();
    await new Promise((r) => setTimeout(r, 0));
    // The server stores it when the hold ends; read the day now (queue still holds it) and again
    // after the server has it but before the queue drops it.
    await useClientStore.getState().loadDayData('member-1', DAY);
    expect(oatsRows()).toHaveLength(1);
    expect(day().dailyTotals.calories).toBe(220);
    release();
    await sync;
    expect(oatsRows()).toHaveLength(1);
    expect(day().dailyTotals.calories).toBe(220);
  });

  it('a send that lands while the refresh fails keeps the food in the day', async () => {
    await saveOatsOffline();
    mockServer.readFails = true;
    await syncFoodLogQueue();
    expect(await getQueueLength()).toBe(0);
    expect(oatsRows()).toHaveLength(1);
    expect(day().dailyTotals.calories).toBe(220);
  });

  it('a food the server refuses stays in the day, marked, in no total', async () => {
    await saveOatsOffline();
    mockServer.refuse = true;
    await syncFoodLogQueue();
    expect(oatsRows()).toHaveLength(1);
    expect(oatsRows()[0].offline).toBe('refused');
    expect(day().dailyTotals.calories).toBe(70);
  });
});
