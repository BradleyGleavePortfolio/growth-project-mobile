import { logApi } from '../../../services/api';
import { repeatPastMeal } from '../quickLog';
import { submitSearchLogOnline } from '../logSubmit';
import { forgetSaveKeys } from '../saveKey';
import type { SearchResult } from '../types';

jest.mock('../../../services/api', () => ({
  logApi: { logFood: jest.fn() },
  foodApi: { create: jest.fn() },
}));

describe('LS-916 B2 repeat recovery through Recent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    forgetSaveKeys();
  });

  it('following the repeat failure instruction to add the unanswered food from Recent does not log it twice', async () => {
    // Same server rule as log.service.ts: a client_uuid upsert returns the
    // earlier entry; a different key means a new intended entry.
    const saved = new Map<string, { id: string; food_item_id: string }>();
    let loseMilkReply = true;
    jest.mocked(logApi.logFood).mockImplementation(async (body) => {
      const key = body.client_uuid!;
      if (!saved.has(key)) saved.set(key, { id: `row-${saved.size}`, food_item_id: body.food_item_id });
      if (body.food_item_id === 'milk' && loseMilkReply) {
        loseMilkReply = false;
        throw Object.assign(new Error('Network Error'), { request: {} });
      }
      return { data: saved.get(key) } as never;
    });
    const meal = {
      mealType: 'breakfast', date: '2026-10-29',
      entries: [
        { foodItemId: 'oats', name: 'Oats', quantityMultiplier: 1, originalQuantity: 40, originalUnit: 'g' },
        { foodItemId: 'milk', name: 'Milk', quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'cup' },
      ],
    } as never;
    const result = await repeatPastMeal(meal, '2026-10-30', 'breakfast');
    expect(result).toEqual({ added: 1, failedNames: ['Milk'] });
    expect(saved.size).toBe(2); // Both reached the server; only one reply was lost.

    // LogScreen.tsx:465 tells the person to add the failed food from Recent.
    await submitSearchLogOnline({
      food: { id: 'milk', name: 'Milk' } as SearchResult,
      date: '2026-10-30', mealType: 'breakfast',
      multiplier: 1, originalQuantity: 1, originalUnit: 'cup',
    });
    expect([...saved.values()].filter((row) => row.food_item_id === 'milk')).toHaveLength(1);
    expect(saved.size).toBe(2);
  });
});
