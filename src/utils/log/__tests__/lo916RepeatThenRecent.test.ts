/**
 * LO-916 B1 (m#916 @ 7151389b): a repeated meal whose one food's answer was lost, then that food added
 * from Recent as the alert tells the member ("Not added: Milk. Check the connection, then add it from
 * Recent."), is saved twice: the Recent add is a new key, so the server keeps a second Milk row.
 * The server here keeps one row per client_uuid (backend log.service upsert on client_uuid).
 */
import api, { logApi } from '../../../services/api';
import { submitSearchLogOnline } from '../logSubmit';
import { repeatPastMeal } from '../quickLog';
import type { SearchResult } from '../types';

jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn(async () => undefined) }));

const lost = () => Object.assign(new Error('Network Error'), { request: {} });

describe('LO-916 B1 repeat, then the alert\'s Recent add', () => {
  it('a food whose repeat answer was lost, added again from Recent as the alert says, is saved once', async () => {
    jest.spyOn(api, 'post').mockResolvedValue({ data: {}, status: 201 } as never);
    const rows = new Map<string, { food_item_id: string }>();
    let milkTries = 0;
    jest.spyOn(logApi, 'logFood').mockImplementation(async (body) => {
      const key = body.client_uuid ?? `none_${rows.size}`;
      if (!rows.has(key)) rows.set(key, { food_item_id: body.food_item_id });
      if (body.food_item_id === 'milk' && milkTries++ === 0) throw lost(); // saved, answer lost
      return { data: { id: key } } as never;
    });

    const meal = {
      mealType: 'breakfast', date: '2026-10-29', entries: [
        { foodItemId: 'oats', name: 'Oats', quantityMultiplier: 0.4, originalQuantity: 40, originalUnit: 'g' },
        { foodItemId: 'milk', name: 'Milk', quantityMultiplier: 1, originalQuantity: 1, originalUnit: 'cup' },
      ],
    } as never;
    const first = await repeatPastMeal(meal, '2026-10-30', 'breakfast');
    expect(first.failedNames).toEqual(['Milk']);

    // The member follows the alert: Milk from Recent, its last portion, to the same meal and day.
    const milk = {
      id: 'milk', name: 'Milk', calories: 42, protein: 3.4, carbs: 5, fat: 1,
      serving_size_grams: 244, nutrient_basis: 'PER_100G', supports_volume_units: true,
    } as unknown as SearchResult;
    await submitSearchLogOnline({
      food: milk, date: '2026-10-30', mealType: 'breakfast', multiplier: 1, originalQuantity: 1, originalUnit: 'cup',
    });

    const milkRows = [...rows.values()].filter((r) => r.food_item_id === 'milk');
    expect(milkRows).toHaveLength(1);
  });
});
