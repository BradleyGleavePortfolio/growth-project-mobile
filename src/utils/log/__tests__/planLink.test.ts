// FOODLINK: every Food log write path carries the plan link, and only while the plan checklist flag is on
// (a backend without FOODLINK answers an unknown field with a 400).
import { logApi } from '../../../services/api';
import { enqueue } from '../../../services/foodLogQueue';
import { planLink } from '../planLink';
import { submitManualLogOffline, submitManualLogOnline, submitSearchLogOffline, submitSearchLogOnline } from '../logSubmit';
import { repeatPastMeal } from '../quickLog';
import type { SearchResult } from '../types';

const mockFlags = { foodPlanChecklist: true };
jest.mock('../../../config/featureFlags', () => {
  const real = jest.requireActual('../../../config/featureFlags');
  return { ...real, get featureFlags() { return { ...real.featureFlags, ...mockFlags }; } };
});
jest.mock('../../../services/api', () => ({
  foodApi: { create: jest.fn().mockResolvedValue({ data: { id: 'food-new' } }) },
  logApi: { logFood: jest.fn().mockResolvedValue({ data: { id: 'entry-1' } }) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn().mockResolvedValue(undefined) }));

const food = { id: 'f1', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5 } as SearchResult;
const search = { food, date: '2026-10-12', mealType: 'snack' as const, multiplier: 1 };
const manual = {
  foodName: 'Toast', calories: '90', protein: '3', carbs: '15', fat: '1', quantity: '1', unit: 'serving',
  date: '2026-10-12', mealType: 'snack' as const,
};
const meal = { date: '2026-10-01', calories: 120, entries: [{ foodItemId: 'f9', name: 'Apple', calories: 120, quantityMultiplier: 1 }] };
const link = { planSlotId: 'slot-s' };

async function everyWrite(l?: typeof link | { fillsUsualMeal: boolean }) {
  await submitSearchLogOnline({ ...search, link: l });
  await submitManualLogOnline({ ...manual, link: l });
  await repeatPastMeal(meal, '2026-10-12', 'snack', l);
  await submitSearchLogOffline({ ...search, link: l });
  await submitManualLogOffline({ ...manual, link: l });
  return [
    ...jest.mocked(logApi.logFood).mock.calls.map((c) => c[0]),
    ...jest.mocked(enqueue).mock.calls.map((c) => (c[0] as { log: Record<string, unknown> }).log),
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.foodPlanChecklist = true;
});

it('sends the plan meal on search, manual and Repeat writes, online and queued', async () => {
  const writes = await everyWrite(link);
  expect(writes).toHaveLength(5);
  for (const w of writes) expect(w).toEqual(expect.objectContaining({ meal_type: 'snack', plan_slot_id: 'slot-s' }));
});

it('sends the usual-day mark the same way', async () => {
  for (const w of await everyWrite({ fillsUsualMeal: true })) {
    expect(w).toEqual(expect.objectContaining({ fills_usual_meal: true }));
    expect(w).not.toHaveProperty('plan_slot_id');
  }
});

it('sends neither field with no link, or with the flag off', async () => {
  for (const w of await everyWrite()) expect(w).not.toHaveProperty('plan_slot_id');
  jest.clearAllMocks();
  mockFlags.foodPlanChecklist = false;
  for (const w of await everyWrite(link)) {
    expect(w).not.toHaveProperty('plan_slot_id');
    expect(w).not.toHaveProperty('fills_usual_meal');
  }
  expect(planLink({ planSlotId: 'x', fillsUsualMeal: true })).toEqual({});
});
