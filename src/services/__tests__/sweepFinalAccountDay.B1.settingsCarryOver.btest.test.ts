/**
 * SWEEP-FINAL-ACCOUNT-DAY B1 (B-TEST, fails on main 89a4e7f9): one client signs out and another signs in on the same
 * phone. The Food tab's water card and Home's water tile read the goal from the phone's settings (useSettings,
 * 'gp_client_settings'); sign-out does not remove that key (authActions.ts ASYNC_SIGN_OUT_KEYS), and the profile seed
 * (useSettings.ts:45-57, :80-85) runs only for a phone with no goal saved, at most once per app session. So the second
 * client is shown the first client's water goal and units as her own, and her own profile goal is never read.
 *
 * Real pieces: authActions.signOut, hooks/useSettings, AsyncStorage (the jest stand-in keeps what is written).
 * Stand-ins: the network (profileApi.get answers each client's own profile), secure storage, the signed-in user cache
 * (who is signed in), the stores sign-out also clears. Names are fictional.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, waitFor } from '@testing-library/react-native';
import { signOut } from '../authActions';
import { useSettings } from '../../hooks/useSettings';
import { profileApi } from '../api';

const mockWho = { id: 'client-a' };

jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn() },
  foodApi: { create: jest.fn() },
  logApi: { logFood: jest.fn() },
}));
jest.mock('../sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: mockWho.id })),
  readUserCache: jest.fn(async () => ({ id: mockWho.id })),
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

/** Each client's own profile on the server: her water goal. */
const profileGoal: Record<string, number> = { 'client-a': 120, 'client-b': 64 };

beforeEach(async () => {
  await AsyncStorage.clear();
  mockWho.id = 'client-a';
  jest.mocked(profileApi.get).mockImplementation((async () => ({ data: { water_goal_oz: profileGoal[mockWho.id] } })) as never);
});

it('SWEEP-FINAL-ACCOUNT-DAY B1: after one client signs out, the next client on the phone sees her own water goal and units, not the first client\'s', async () => {
  // Client A on this phone: her profile's 120 oz goal is seeded onto the phone, and she picks kilograms.
  const a = await renderHook(() => useSettings());
  await waitFor(() => expect(a.result.current.settings.waterGoalOz).toBe(120));
  a.result.current.updateSetting('unit', 'kg');
  await waitFor(() => expect(a.result.current.settings.unit).toBe('kg'));
  a.unmount();

  await signOut();

  // Client B signs in on the same phone. Her profile's goal is 64 oz.
  mockWho.id = 'client-b';
  const b = await renderHook(() => useSettings());
  await waitFor(() => expect(b.result.current.loaded).toBe(true));
  await new Promise((r) => setTimeout(r, 50));

  // At main she is shown 120 oz and kilograms: client A's goal and units (the Food tab: "0 / 120 oz"), and her own
  // profile is never asked.
  expect(b.result.current.settings.unit).toBe('lbs');
  expect(b.result.current.settings.waterGoalOz).toBe(64);
});
