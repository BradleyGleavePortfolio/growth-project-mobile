// SESSION-KEEP-130 (EXPLORE-CLIENT-129 B1): sign-out removes the foods and
// workouts that are only on this phone. Before it does, one bounded try to
// send them; the sign-out confirm names whatever is still unsent.
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

const { foodApi, logApi } = jest.requireMock('../api') as {
  foodApi: { create: jest.Mock };
  logApi: { logFood: jest.Mock };
};
const engine = jest.requireMock('../../offline/sync/sync-engine') as {
  deleteWorkoutLogsForUser: jest.Mock;
  countQueuedWorkouts: jest.Mock;
  pushQueuedWorkouts: jest.Mock;
};

const NO_ANSWER = Object.assign(new Error('Cannot reach server.'), { code: 'ERR_NETWORK' });

async function logFoodOffline(): Promise<void> {
  await enqueue({
    kind: 'manual',
    food: {
      name: 'Oats', brand_or_restaurant: null, category: 'grains', serving_description: '1 cup',
      serving_size_grams: 80, calories: 300, protein_g: 10, carbs_g: 54, fat_g: 5, tags: [], search_aliases: [],
    },
    log: { date: '2026-10-07', meal_type: 'breakfast', quantity_multiplier: 1 },
  });
}

async function leaveWorkoutOpen(): Promise<void> {
  await AsyncStorage.setItem('active_workout_session:user-A', JSON.stringify({ version: 1 }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  engine.countQueuedWorkouts.mockResolvedValue(0);
  foodApi.create.mockResolvedValue({ data: { id: 'food-1' } });
  logApi.logFood.mockResolvedValue({ data: {} });
});

afterEach(() => jest.useRealTimers());

it('signal back: foods and finished workouts on the phone are sent before sign-out removes them', async () => {
  await logFoodOffline();
  engine.countQueuedWorkouts.mockResolvedValueOnce(1).mockResolvedValue(0);

  await signOut();

  expect(logApi.logFood).toHaveBeenCalledTimes(1);
  expect(logApi.logFood).toHaveBeenCalledWith(expect.objectContaining({ food_item_id: 'food-1', client_uuid: expect.any(String) }));
  expect(engine.pushQueuedWorkouts).toHaveBeenCalledTimes(1);
  const wipe = engine.deleteWorkoutLogsForUser.mock.invocationCallOrder[0];
  expect(logApi.logFood.mock.invocationCallOrder[0]).toBeLessThan(wipe);
  expect(engine.pushQueuedWorkouts.mock.invocationCallOrder[0]).toBeLessThan(wipe);
  expect(await AsyncStorage.getItem('pending_food_logs_user-A')).toBeNull();
});

it('still no signal: the confirm says what will be removed from this phone', async () => {
  await logFoodOffline();
  await leaveWorkoutOpen();
  engine.countQueuedWorkouts.mockResolvedValue(1);
  foodApi.create.mockRejectedValue(NO_ANSWER);

  await expect(prepareSignOutConfirm('user-A')).resolves.toBe(
    '2 workouts and 1 food have not synced yet and will be removed from this phone.',
  );
  // One try was made, and the food is still on the phone (only sign-out removes it).
  expect(foodApi.create).toHaveBeenCalledTimes(1);
  expect(engine.pushQueuedWorkouts).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem('pending_food_logs_user-A'))!)).toHaveLength(1);
});

it('nothing waiting: no send is attempted and the confirm is the usual question', async () => {
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('Are you sure you want to sign out?');
  expect(foodApi.create).not.toHaveBeenCalled();
  expect(engine.pushQueuedWorkouts).not.toHaveBeenCalled();
});

it('a send that hangs on a weak signal is cut off, so the confirm still appears', async () => {
  await logFoodOffline();
  foodApi.create.mockReturnValue(new Promise(() => undefined));
  jest.useFakeTimers();

  const confirm = prepareSignOutConfirm('user-A');
  await jest.advanceTimersByTimeAsync(5000);

  await expect(confirm).resolves.toBe('1 food has not synced yet and will be removed from this phone.');
});

it('a second tap on Sign out while the first send runs opens no second confirm', async () => {
  await logFoodOffline();
  foodApi.create.mockReturnValue(new Promise(() => undefined));
  jest.useFakeTimers();

  const first = prepareSignOutConfirm('user-A');
  const second = prepareSignOutConfirm('user-A');
  await jest.advanceTimersByTimeAsync(5000);

  await expect(second).resolves.toBeNull();
  await expect(first).resolves.toBe('1 food has not synced yet and will be removed from this phone.');
  // Once the first confirm is ready, the next tap gets its own confirm.
  const third = prepareSignOutConfirm('user-A');
  await jest.advanceTimersByTimeAsync(5000);
  await expect(third).resolves.toBe('1 food has not synced yet and will be removed from this phone.');
});

it('the sign-out after a refused renewal does not try to send: that session can no longer send', async () => {
  await logFoodOffline();
  engine.countQueuedWorkouts.mockResolvedValue(1);

  await signOut(undefined, { sessionFence: Object.freeze({}) as SessionFencePass });

  expect(foodApi.create).not.toHaveBeenCalled();
  expect(logApi.logFood).not.toHaveBeenCalled();
  expect(engine.pushQueuedWorkouts).not.toHaveBeenCalled();
  expect(engine.deleteWorkoutLogsForUser).toHaveBeenCalledWith('user-A');
});

it('names each kind in words, singular and plural', () => {
  expect(unsyncedLogsMessage({ workouts: 1, foods: 0 })).toBe(
    '1 workout has not synced yet and will be removed from this phone.',
  );
  expect(unsyncedLogsMessage({ workouts: 0, foods: 3 })).toBe(
    '3 foods have not synced yet and will be removed from this phone.',
  );
  expect(unsyncedLogsMessage({ workouts: 1, foods: 1 })).toBe(
    '1 workout and 1 food have not synced yet and will be removed from this phone.',
  );
  expect(unsyncedLogsMessage({ workouts: 0, foods: 0 })).toBeNull();
});
