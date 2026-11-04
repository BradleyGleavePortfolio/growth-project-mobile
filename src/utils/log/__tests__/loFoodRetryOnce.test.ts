/**
 * LO-FOOD B6 (audit of main, agent 187): a food logged online whose reply is
 * lost (the 30 s timeout, a dropped connection) is saved on the server, but
 * the phone says "This food was not added. Check the connection and try
 * again." The client taps Log food again. The server de-duplicates a log only
 * by client_uuid (log.service.ts upsert); the online path sends none, so the
 * retry saves the food a second time.
 */
type Row = { id: string; client_uuid?: string; food_item_id: string };
const mockServerRows: Row[] = [];
let mockDropNextReply = false;

jest.mock('../../../services/api', () => ({
  __esModule: true,
  foodApi: { create: jest.fn() },
  logApi: {
    logFood: jest.fn(async (data: { client_uuid?: string; food_item_id: string }) => {
      // The server's rule (backend src/log/log.service.ts:48-56): upsert on
      // client_uuid when one is sent, otherwise a plain create.
      const existing = data.client_uuid
        ? mockServerRows.find((r) => r.client_uuid === data.client_uuid)
        : undefined;
      if (!existing) {
        mockServerRows.push({ id: `row-${mockServerRows.length + 1}`, client_uuid: data.client_uuid, food_item_id: data.food_item_id });
      }
      if (mockDropNextReply) {
        mockDropNextReply = false;
        const err = new Error('timeout of 30000ms exceeded') as Error & { code?: string };
        err.code = 'ECONNABORTED';
        throw err;
      }
      return { data: {} };
    }),
  },
}));

import { submitSearchLogOnline } from '../logSubmit';
import type { SearchResult } from '../types';

const oats: SearchResult = {
  id: 'food-oats', name: 'Rolled oats', calories: 375, protein: 13, carbs: 67, fat: 7, nutrient_basis: 'PER_100G',
} as SearchResult;

describe('LO-FOOD B6: retry after a lost reply', () => {
  beforeEach(() => {
    mockServerRows.length = 0;
    mockDropNextReply = false;
  });

  it('a food whose reply was lost, logged again after "This food was not added", is saved once', async () => {
    const args = { food: oats, date: '2026-10-30', mealType: 'breakfast' as const, multiplier: 0.4, originalQuantity: 40, originalUnit: 'g' };
    mockDropNextReply = true;
    await expect(submitSearchLogOnline(args)).rejects.toThrow('timeout');
    // The client reads the alert and taps Log food again on the same picker.
    await submitSearchLogOnline(args);
    expect(mockServerRows).toHaveLength(1);
  });
});
