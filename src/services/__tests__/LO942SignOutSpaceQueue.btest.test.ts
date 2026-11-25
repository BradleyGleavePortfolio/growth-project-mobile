/**
 * LO-942 B1 (agent 200, Opus lens, m#942 @ 22f62025): a space text queued with no signal is removed by a sign-out
 * with no try to send it and no word in the sign-out confirm. SESSION-KEEP-130 (authActions.ts:353-394, prepareSignOutConfirm :403) sends and
 * counts the coach messages, foods and workouts still only on this phone; readUnsynced (:342-350) never reads the
 * space outbox, and the 'logout' reset (spaceChatOutbox.ts:143-153, :158) deletes every space_outbox_* key.
 * Real space outbox and real authActions; device storage, connectivity and the API module doubled.
 */
const mockStore = new Map<string, string>();
jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => undefined),
  prefsStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  cacheStorage: {
    getString: (k: string) => mockStore.get(k),
    getStringAsync: async (k: string) => mockStore.get(k),
    set: (k: string, v: string) => { mockStore.set(k, v); },
    getAllKeys: async () => [...mockStore.keys()],
    delete: async (k: string) => { mockStore.delete(k); },
  },
  secureStorage: { getString: () => undefined },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));
jest.mock('../secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../api', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
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
jest.mock('../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { prepareSignOutConfirm } from '../authActions';
import { SPACE_OUTBOX_PREFIX, setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox } from '../../components/community/space-chat/spaceChatOutbox';

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(async () => {
  mockStore.clear();
  await AsyncStorage.clear();
});

it('LO942 B1: a space text queued with no signal is named in the sign-out confirm before a sign-out removes it', async () => {
  startSpaceOutbox('user-A');
  setSpaceOutboxOnline(false);
  await settle();
  spaceOutbox.add('space-1', 'See you at 6');
  await settle();
  // The text is waiting on this phone for user-A.
  expect(mockStore.get(`${SPACE_OUTBOX_PREFIX}user-A`)).toContain('See you at 6');

  const confirm = await prepareSignOutConfirm('user-A');

  // Main's own words for a coach message still only on this phone (authActions.ts:386-395).
  expect(confirm).toBe('1 message has not synced yet and will be removed from this phone.');
});
