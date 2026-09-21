/**
 * foodLogQueue — captured-owner fence, REAL identity composition (S6 R3).
 *
 * Unlike foodLogQueue.test.ts, `lib/userCache` and `storage/mmkv` are NOT
 * mocked: the queue reads the owner from the real in-process identity mirror
 * (AsyncStorage shim underneath), and owner changes are produced by the real
 * `setUserCache` / `clearUserCache` calls a sign-in / sign-out performs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearUserCache, setUserCache } from '../../lib/userCache';
import { enqueue, flush, getQueueLength } from '../foodLogQueue';

jest.mock('../api', () => {
  const create = jest.fn();
  const logFood = jest.fn();
  return { __create: create, __logFood: logFood, foodApi: { create }, logApi: { logFood } };
});

const api = jest.requireMock('../api') as { __create: jest.Mock; __logFood: jest.Mock };

const userA = { id: 'user-A', email: 'a@example.com' };
const userB = { id: 'user-B', email: 'b@example.com' };

const searchEntry = (foodItemId: string) =>
  ({
    kind: 'search',
    foodItemId,
    log: { date: '2026-09-21', meal_type: 'lunch', quantity_multiplier: 1 },
  }) as const;

async function queueFor(userId: string | null): Promise<string[]> {
  const raw = await AsyncStorage.getItem(
    userId ? `pending_food_logs_${userId}` : 'pending_food_logs_anonymous',
  );
  return raw ? (JSON.parse(raw) as Array<{ foodItemId: string }>).map((q) => q.foodItemId) : [];
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearUserCache();
  api.__create.mockReset();
  api.__logFood.mockReset();
});

describe('foodLogQueue — owner captured from the real identity mirror', () => {
  it('before hydration/sign-in the queue is anonymous; after sign-in it is the user’s (no re-attribution)', async () => {
    await enqueue(searchEntry('anon-1'));
    expect(await queueFor(null)).toEqual(['anon-1']);

    await setUserCache(userA);
    await enqueue(searchEntry('a-1'));
    expect(await queueFor('user-A')).toEqual(['a-1']);
    // The anonymous item is NOT silently attributed to A.
    expect(await queueFor(null)).toEqual(['anon-1']);
    expect(await getQueueLength()).toBe(1);
  });

  it('enqueue refuses to write back when the owner changed between read and write', async () => {
    await setUserCache(userA);
    // Make the queue read slow enough for a sign-out to land in between.
    const realGet = AsyncStorage.getItem.bind(AsyncStorage);
    let once = true;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (k) => {
      if (once && k === 'pending_food_logs_user-A') {
        once = false;
        await clearUserCache(); // sign-out mid-operation
      }
      return realGet(k);
    });
    await expect(enqueue(searchEntry('late'))).rejects.toThrow(/owner changed/);
    jest.restoreAllMocks();
    expect(await queueFor('user-A')).toEqual([]);
    expect(await queueFor(null)).toEqual([]);
  });

  it('flush stops when A signs out and B signs in mid-flush: nothing posted for B, nothing written to B’s key', async () => {
    await setUserCache(userA);
    await enqueue(searchEntry('a-1'));
    await enqueue(searchEntry('a-2'));

    api.__logFood.mockImplementationOnce(async () => {
      await clearUserCache();
      await setUserCache(userB); // account switch while a-1's POST is in flight
      return { data: {} };
    });
    api.__logFood.mockResolvedValue({ data: {} });

    const res = await flush();
    expect(api.__logFood).toHaveBeenCalledTimes(1); // a-2 never posted under B's session
    expect(res.flushed).toBe(0);
    expect(res.remaining).toBe(2);
    expect(await queueFor('user-A')).toEqual(['a-1', 'a-2']); // untouched, retried by A later
    expect(await queueFor('user-B')).toEqual([]);
    expect(await AsyncStorage.getItem('pending_food_logs_user-B')).toBeNull();
  });

  it('flush with a stable owner drains the owner’s queue normally', async () => {
    await setUserCache(userA);
    await enqueue(searchEntry('a-1'));
    api.__logFood.mockResolvedValue({ data: {} });
    const res = await flush();
    expect(res).toEqual({ flushed: 1, remaining: 0, dropped: 0 });
    expect(await queueFor('user-A')).toEqual([]);
  });
});
