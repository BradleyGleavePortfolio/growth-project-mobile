/**
 * FR-916R2 F1 (own tests): a save resent after a lost answer keeps the first key on every path, and only then.
 * The food was entered by hand yesterday ("2 servings": quantity_multiplier 1, original 2 serving) and comes
 * back today through Repeat and Recent, as the Repeat alert says ("Check the connection, then add it from
 * Recent."). The server here keeps one row per client_uuid (backend log.service upsert on client_uuid).
 */
import { act, renderHook } from '@testing-library/react-native';
import { logApi } from '../../services/api';
import { enqueue } from '../../services/foodLogQueue';
import { useFoodBrowse } from '../useFoodBrowse';
import { repeatPastMeal } from '../../utils/log/quickLog';
import type { PastMeal } from '../useFoodBrowse';
import { submitSearchLogOffline, submitSearchLogOnline } from '../../utils/log/logSubmit';
import { quantityMultiplier } from '../../utils/log/macros';
import { addDays } from '../../utils/date';
import { forgetSaveKeys } from '../../utils/log/saveKey';
import type { SearchResult } from '../../utils/log/types';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  foodApi: { create: jest.fn() },
  logApi: { getDaily: jest.fn(), logFood: jest.fn() },
}));
jest.mock('../../services/foodLogQueue', () => ({ enqueue: jest.fn(async () => undefined) }));

const TODAY = '2026-10-30';
const YESTERDAY = addDays(TODAY, -1);
const lost = () => Object.assign(new Error('Network Error'), { request: {} });

const handRow = {
  food_item_id: 'oats-own',
  meal_type: 'breakfast',
  quantity_multiplier: 1,
  original_quantity: 2,
  original_unit: 'serving',
  food_item: {
    id: 'oats-own', name: 'Overnight oats', calories: 320, protein_g: 12, carbs_g: 50, fat_g: 8,
    nutrient_basis: 'PER_SERVING', serving_size_grams: 0, serving_description: '2 serving',
  },
};

/** Yesterday's breakfast as Repeat offers it, and the food as Recent offers it, with Recent's prefilled portion. */
async function yesterday(rows: unknown[]): Promise<{ meal: PastMeal; recent: SearchResult; addFromRecent: (online: boolean) => Promise<void> }> {
  (logApi.getDaily as jest.Mock).mockImplementation(async (d: string) => ({ data: { entries: d === YESTERDAY ? rows : [] } }));
  const { result } = await renderHook(() => useFoodBrowse('viewer', TODAY));
  await act(async () => { await result.current.loadBrowseFoods(); });
  const meal = result.current.lastMeals.breakfast!;
  const recent = result.current.recentFoods.find((f) => f.name === 'Overnight oats')!;
  const qty = recent.last_quantity ?? 1;
  const unit = recent.last_unit ?? 'serving';
  const args = {
    food: recent, date: TODAY, mealType: 'breakfast' as const,
    multiplier: quantityMultiplier(recent, qty, unit), originalQuantity: qty, originalUnit: unit,
  };
  return { meal, recent, addFromRecent: (online) => (online ? submitSearchLogOnline(args) : submitSearchLogOffline(args)) };
}

/** The server: one row per key; `lose` says which sends (1-based) save but lose their answer. */
function server(lose: number[]) {
  const rows = new Map<string, Record<string, unknown>>();
  let n = 0;
  (logApi.logFood as jest.Mock).mockImplementation(async (body: Record<string, unknown>) => {
    n += 1;
    const key = String(body.client_uuid);
    if (!rows.has(key)) rows.set(key, body);
    if (lose.includes(n)) throw lost();
    return { data: { id: key } };
  });
  return rows;
}

describe('FR-916R2 F1 a resent save keeps its first key, on every path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    forgetSaveKeys();
  });

  it('a hand-entered food whose repeat answer was lost, added again from Recent while offline, queues the first key', async () => {
    const rows = server([1]);
    const { meal, addFromRecent } = await yesterday([handRow]);
    expect((await repeatPastMeal(meal, TODAY, 'breakfast')).failedNames).toEqual(['Overnight oats']);
    const lostKey = [...rows.keys()][0];

    await addFromRecent(false);

    // The queue entry takes the lost save's key as its id, so its flush upserts the row already saved.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue as jest.Mock).mock.calls[0][1]).toBe(lostKey);
  });

  it('a meant second log after an answered first is a new save (a new key, a second row)', async () => {
    const rows = server([]);
    const { meal, addFromRecent } = await yesterday([handRow]);
    expect((await repeatPastMeal(meal, TODAY, 'breakfast')).failedNames).toEqual([]);

    await addFromRecent(true);

    expect([...rows.values()].filter((r) => r.food_item_id === 'oats-own')).toHaveLength(2);
  });

  it('the same food twice in one repeat, both answers lost: each Recent add recovers one, and a third is a new row', async () => {
    const rows = server([1, 2]);
    const { meal, addFromRecent } = await yesterday([handRow, { ...handRow }]);
    expect((await repeatPastMeal(meal, TODAY, 'breakfast')).failedNames).toEqual(['Overnight oats', 'Overnight oats']);
    expect(rows.size).toBe(2);

    await addFromRecent(true);
    await addFromRecent(true);
    expect(rows.size).toBe(2);

    await addFromRecent(true);
    expect(rows.size).toBe(3);
  });
});
