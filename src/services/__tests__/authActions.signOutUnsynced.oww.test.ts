/**
 * OFFLINE-WATER-WEIGHT-M (M4): a glass of water and a weigh-in saved with no signal are in the same queue as foods.
 * Sign-out's one bounded try sends them; what is left is named truly (never counted as foods); the queue and sent
 * keys are wiped as today, and a second account on the phone sees none of them.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { prepareSignOutConfirm, signOut, unsyncedLogsMessage } from '../authActions';
import { enqueue } from '../foodLogQueue';
import type { SessionFencePass } from '../sessionFence';

jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn() },
  waterApi: { log: jest.fn() },
  weightApi: { log: jest.fn() },
}));

jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-A' })),
  readUserCache: jest.fn(async () => ({ id: 'user-A' })),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: jest.fn(async () => undefined),
}));
jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => undefined),
  prefsStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  cacheStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  secureStorage: { getString: () => undefined },
}));
// fastingDb pulls in expo-sqlite, which does not load under Jest.
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

const { foodApi, logApi, waterApi, weightApi } = jest.requireMock('../api') as {
  foodApi: { create: jest.Mock };
  logApi: { logFood: jest.Mock };
  waterApi: { log: jest.Mock };
  weightApi: { log: jest.Mock };
};
const engine = jest.requireMock('../../offline/sync/sync-engine') as {
  deleteWorkoutLogsForUser: jest.Mock;
  countQueuedWorkouts: jest.Mock;
  pushQueuedWorkouts: jest.Mock;
};

const NO_ANSWER = Object.assign(new Error('Cannot reach server.'), { code: 'ERR_NETWORK' });

const DAY = '2026-11-12';

/** A glass and a weigh-in as this build queues them (foodLogQueue, kinds 'water' and 'weight'). */
async function saveWaterAndWeighInOffline(): Promise<void> {
  const raw = await AsyncStorage.getItem('pending_food_logs_user-A');
  const queue = raw ? JSON.parse(raw) : [];
  queue.push({ id: 'pfl_w1', createdAt: 1, kind: 'water', log: { date: DAY, amount_ml: 237 } });
  queue.push({ id: 'pfl_g1', createdAt: 2, kind: 'weight', log: { date: DAY, weight_lbs: 181.4 } });
  await AsyncStorage.setItem('pending_food_logs_user-A', JSON.stringify(queue));
}
async function logFoodOffline(): Promise<void> {
  await enqueue({
    kind: 'manual',
    food: {
      name: 'Oats', brand_or_restaurant: null, category: 'grains', serving_description: '1 cup',
      serving_size_grams: 80, calories: 300, protein_g: 10, carbs_g: 54, fat_g: 5, tags: [], search_aliases: [],
    },
    log: { date: DAY, meal_type: 'breakfast', quantity_multiplier: 1 },
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  engine.countQueuedWorkouts.mockResolvedValue(0);
  foodApi.create.mockResolvedValue({ data: { id: 'food-1' } });
  logApi.logFood.mockResolvedValue({ data: {} });
  waterApi.log.mockResolvedValue({ data: { id: 'w-1' } });
  weightApi.log.mockResolvedValue({ data: { id: 'g-1' } });
});

it('M4: signal back: the one try sends the food, the glass and the weigh-in, each with its key, before the wipe', async () => {
  await logFoodOffline();
  await saveWaterAndWeighInOffline();

  await signOut();

  expect(waterApi.log).toHaveBeenCalledWith({ amount_ml: 237, date: DAY }, 'pfl_w1');
  expect(weightApi.log).toHaveBeenCalledWith(expect.objectContaining({ weight_lbs: 181.4, date: DAY }), 'pfl_g1');
  const wipe = engine.deleteWorkoutLogsForUser.mock.invocationCallOrder[0];
  expect(waterApi.log.mock.invocationCallOrder[0]).toBeLessThan(wipe);
  expect(weightApi.log.mock.invocationCallOrder[0]).toBeLessThan(wipe);
  expect(await AsyncStorage.getItem('pending_food_logs_user-A')).toBeNull();
  expect(await AsyncStorage.getItem('sent_food_logs_user-A')).toBeNull();
});

it('M4: still no signal: the confirm names the food, the water entry and the weigh-in, never as foods', async () => {
  await logFoodOffline();
  await saveWaterAndWeighInOffline();
  foodApi.create.mockRejectedValue(NO_ANSWER);

  await expect(prepareSignOutConfirm('user-A')).resolves.toBe(
    '1 food, 1 water entry and 1 weigh-in have not synced yet and will be removed from this phone.',
  );
});

it('M4: only a glass and a weigh-in waiting (refused by the server): named, and the foods count is not raised', async () => {
  await saveWaterAndWeighInOffline();
  waterApi.log.mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 400 } }));
  weightApi.log.mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 400 } }));

  await expect(prepareSignOutConfirm('user-A')).resolves.toBe(
    '1 water entry and 1 weigh-in have not synced yet and will be removed from this phone.',
  );
});

it('M4: the words, singular and plural', () => {
  expect(unsyncedLogsMessage({ workouts: 0, foods: 0, messages: 0, water: 2, weighIns: 2 })).toBe(
    '2 water entries and 2 weigh-ins have not synced yet and will be removed from this phone.',
  );
  expect(unsyncedLogsMessage({ workouts: 0, foods: 0, messages: 0, water: 1 })).toBe(
    '1 water entry has not synced yet and will be removed from this phone.',
  );
});

it("M4: after sign-out a second account on the phone sees none of A's glasses or weigh-ins", async () => {
  await saveWaterAndWeighInOffline();
  waterApi.log.mockRejectedValue(NO_ANSWER);

  await signOut();

  const keys = await AsyncStorage.getAllKeys();
  expect(keys.filter((k) => k.startsWith('pending_food_logs_') || k.startsWith('sent_food_logs_'))).toEqual([]);
});
