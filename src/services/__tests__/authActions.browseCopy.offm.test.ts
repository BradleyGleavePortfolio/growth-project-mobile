// OFFLINE-FOOD-M: the add sheet's kept Recent, Frequent and Repeat lists are keyed by member and
// go at sign-out; another account's kept lists on the same phone stay.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut } from '../authActions';

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


beforeEach(async () => {
  await AsyncStorage.clear();
});

it('sign-out removes this member\'s kept add-sheet lists and keeps another account\'s', async () => {
  const mine = JSON.stringify({ readFor: '2026-11-04', recentFoods: [{ name: 'Rolled oats' }], frequentFoods: [], lastMeals: {} });
  const theirs = JSON.stringify({ readFor: '2026-11-04', recentFoods: [{ name: 'Rice' }], frequentFoods: [], lastMeals: {} });
  await AsyncStorage.setItem('food_browse_copy_user-A', mine);
  await AsyncStorage.setItem('food_browse_copy_user-B', theirs);

  await signOut();

  expect(await AsyncStorage.getItem('food_browse_copy_user-A')).toBeNull();
  expect(await AsyncStorage.getItem('food_browse_copy_user-B')).toBe(theirs);
});
