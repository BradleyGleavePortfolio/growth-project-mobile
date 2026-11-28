/**
 * FIX-KM-1 step 6: the Kitchen's add step, exported once (kitchenAdd.ts) so KITCHEN-DOOR-M adds a saved meal the same
 * way the Kitchen's sheet does. One intended save, one key (withSaveKey, KITCHEN-M R6), and the answer read as one of
 * six outcomes: added | empty | food-not-found | meal-gone | lost | refused. The api is mocked at its edge.
 */
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: (...a: unknown[]) => mockPost(...a) },
}));

import { forgetSaveKeys } from '../../../../utils/log/saveKey';
import { addSavedMeal } from '../kitchenAdd';

const answer = (data: unknown) => () => Promise.resolve({ data });
const refusal = (status: number, message: unknown = '') => () =>
  Promise.reject(Object.assign(new Error(String(message)), { response: { status, data: { message } } }));
const lost = () => Promise.reject(new Error('Network Error'));
const sent = () => mockPost.mock.calls as Array<[string, { date: string; meal_type: string; client_uuid: string }, { headers: Record<string, string> }]>;
const keys = () => sent().map((c) => c[1].client_uuid);

beforeEach(() => {
  mockPost.mockReset();
  forgetSaveKeys();
});

describe('addSavedMeal: one intended save, one key, six outcomes', () => {
  it('added: a non-empty answer; one post with the day, the meal and the key in body and header', async () => {
    mockPost.mockImplementationOnce(answer([{ id: 'n1' }, { id: 'n2' }]));
    await expect(addSavedMeal('m1', '2026-10-13', 'breakfast')).resolves.toBe('added');
    expect(sent()).toHaveLength(1);
    const [url, body, config] = sent()[0];
    expect(url).toBe('/me/foods/saved-meals/m1/log');
    expect(body).toEqual({ date: '2026-10-13', meal_type: 'breakfast', client_uuid: expect.stringMatching(/^pfl_/) });
    expect(config).toEqual({ headers: { 'Idempotency-Key': body.client_uuid } });
  });

  it('empty: an answer of [] (or not a list) wrote nothing; the key is let go', async () => {
    mockPost.mockImplementationOnce(answer([]));
    await expect(addSavedMeal('m1', '2026-10-13', 'lunch')).resolves.toBe('empty');
    mockPost.mockImplementationOnce(answer({ rows: 1 }));
    await expect(addSavedMeal('m1', '2026-10-13', 'lunch')).resolves.toBe('empty');
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('food-not-found: a 404 that does not name the saved meal; the key is let go', async () => {
    mockPost.mockImplementationOnce(refusal(404, 'Food not found'));
    await expect(addSavedMeal('m1', '2026-10-13', 'dinner')).resolves.toBe('food-not-found');
    mockPost.mockImplementationOnce(answer([{ id: 'n1' }]));
    await expect(addSavedMeal('m1', '2026-10-13', 'dinner')).resolves.toBe('added');
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('meal-gone: a 404 that names the saved meal (also as a list of messages)', async () => {
    mockPost.mockImplementationOnce(refusal(404, 'Saved meal not found'));
    await expect(addSavedMeal('m1', '2026-10-13', 'snack')).resolves.toBe('meal-gone');
    mockPost.mockImplementationOnce(refusal(404, ['Saved meal not found']));
    await expect(addSavedMeal('m1', '2026-10-13', 'snack')).resolves.toBe('meal-gone');
  });

  it('lost: no answer or a 5xx keeps the key, so the same save sends the same key; another meal is another key', async () => {
    mockPost.mockImplementationOnce(lost);
    await expect(addSavedMeal('m1', '2026-10-13', 'breakfast')).resolves.toBe('lost');
    mockPost.mockImplementationOnce(refusal(503, 'Service Unavailable'));
    await expect(addSavedMeal('m1', '2026-10-13', 'breakfast')).resolves.toBe('lost');
    mockPost.mockImplementationOnce(answer([{ id: 'n1' }]));
    await expect(addSavedMeal('m1', '2026-10-13', 'breakfast')).resolves.toBe('added');
    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).toBe(keys()[0]);
    mockPost.mockImplementationOnce(lost);
    await expect(addSavedMeal('m1', '2026-10-13', 'lunch')).resolves.toBe('lost');
    expect(keys()[3]).not.toBe(keys()[0]);
  });

  it('refused: any other answer below 500 (400, 403, 429) lets the key go', async () => {
    for (const status of [400, 403, 429]) {
      mockPost.mockImplementationOnce(refusal(status, 'No'));
      await expect(addSavedMeal('m1', '2026-10-13', 'breakfast')).resolves.toBe('refused');
    }
    expect(new Set(keys()).size).toBe(3);
  });
});
