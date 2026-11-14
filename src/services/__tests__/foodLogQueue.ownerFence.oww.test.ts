/**
 * OFFLINE-WATER-WEIGHT-M (M3): the queue's owner fence with a glass of water and a weigh-in, beside
 * foodLogQueue.ownerFence.test.ts (its assertions stay as they are). The REAL identity mirror (lib/userCache) runs:
 * owner changes are the real setUserCache / clearUserCache a sign-in and a sign-out make.
 *   - A's glass and weigh-in are never sent under B's session, and stay A's.
 *   - Once B is signed in, B's reads (the queue, the sent list) never hold A's glass or weigh-in.
 *   - A glass or a weigh-in never lands in the anonymous queue (no owner: refused), so the no-owner flush can never
 *     send one under another account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearUserCache, setUserCache } from '../../lib/userCache';
import { enqueueWaterWeight, flush, readWaterWeight } from '../foodLogQueue';

jest.mock('../api', () => {
  const water = jest.fn();
  const weight = jest.fn();
  return {
    __water: water, __weight: weight,
    foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn() },
    waterApi: { log: water }, weightApi: { log: weight },
  };
});
const api = jest.requireMock('../api') as { __water: jest.Mock; __weight: jest.Mock };

const userA = { id: 'user-A', email: 'a@example.com' };
const userB = { id: 'user-B', email: 'b@example.com' };
const DAY = '2026-11-12';
const glass = { kind: 'water', log: { date: DAY, amount_ml: 237 } } as const;
const weighIn = { kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } } as const;
const raw = async (key: string) => JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as { id: string; kind: string }[];

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearUserCache();
  api.__water.mockReset();
  api.__weight.mockReset();
});

describe('OFFLINE-WATER-WEIGHT-M: a glass and a weigh-in stay with the account that saved them', () => {
  it("A's glass and weigh-in are queued under A's key; with B signed in, B's flush never sends them", async () => {
    await setUserCache(userA);
    await enqueueWaterWeight('user-A', glass, 'pfl_a_w');
    await enqueueWaterWeight('user-A', weighIn, 'pfl_a_g');
    expect((await raw('pending_food_logs_user-A')).map((q) => q.kind)).toEqual(['water', 'weight']);

    await clearUserCache();
    await setUserCache(userB);
    api.__water.mockResolvedValue({ data: { id: 'w-1' } });
    api.__weight.mockResolvedValue({ data: { id: 'g-1' } });
    await flush();
    expect(api.__water).not.toHaveBeenCalled();
    expect(api.__weight).not.toHaveBeenCalled();
    expect((await raw('pending_food_logs_user-A')).map((q) => q.id)).toEqual(['pfl_a_w', 'pfl_a_g']);
    expect(await readWaterWeight()).toEqual({ queue: [], sent: [] });
  });

  it("a sign-out mid-flush stops it: A's next entry is not sent under B, and nothing is written into B's lists", async () => {
    await setUserCache(userA);
    await enqueueWaterWeight('user-A', glass, 'pfl_a_w');
    await enqueueWaterWeight('user-A', weighIn, 'pfl_a_g');
    api.__water.mockImplementation(async () => {
      await clearUserCache();
      await setUserCache(userB);
      return { data: { id: 'w-1' } };
    });
    await flush();
    expect(api.__water).toHaveBeenCalledTimes(1);
    expect(api.__weight).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('pending_food_logs_user-B')).toBeNull();
    expect(await AsyncStorage.getItem('sent_food_logs_user-B')).toBeNull();
    expect((await raw('pending_food_logs_user-A')).map((q) => q.id)).toContain('pfl_a_g');
  });

  it("A's sent glass is never in B's reads", async () => {
    await setUserCache(userA);
    await enqueueWaterWeight('user-A', glass, 'pfl_a_w');
    api.__water.mockResolvedValue({ data: { id: 'w-1' } });
    await flush();
    expect((await readWaterWeight()).sent.map((s) => s.id)).toEqual(['pfl_a_w']);
    await clearUserCache();
    await setUserCache(userB);
    expect(await readWaterWeight()).toEqual({ queue: [], sent: [] });
  });

  it('no owner, or another owner than the one signed in: the glass or weigh-in is refused, never in the anonymous queue', async () => {
    await expect(enqueueWaterWeight('user-A', glass)).rejects.toThrow();
    await setUserCache(userB);
    await expect(enqueueWaterWeight('user-A', weighIn)).rejects.toThrow();
    await expect(enqueueWaterWeight('', glass)).rejects.toThrow();
    expect(await AsyncStorage.getItem('pending_food_logs_anonymous')).toBeNull();
    expect(await AsyncStorage.getItem('pending_food_logs_user-A')).toBeNull();
    expect(await AsyncStorage.getItem('pending_food_logs_user-B')).toBeNull();
  });
});
