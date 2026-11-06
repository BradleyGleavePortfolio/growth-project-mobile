import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { prepareSignOutConfirm, signOut } from '../authActions';
import { authEvents } from '../../utils/authEvents';
import { resetVoiceOutbox } from '../../hooks/useVoiceOutbox';
import {
  setSpaceOutboxOnline, spaceOutbox, startSpaceOutbox,
} from '../../components/community/space-chat/spaceChatOutbox';

const mockCache = new Map<string, string>();
jest.mock('../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => { mockCache.clear(); }),
  prefsStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined },
  cacheStorage: {
    getString: (key: string) => mockCache.get(key),
    getStringAsync: async (key: string) => mockCache.get(key),
    getAllKeys: async () => [...mockCache.keys()],
    set: async (key: string, value: string) => { mockCache.set(key, value); },
    delete: async (key: string) => { mockCache.delete(key); },
  },
  secureStorage: { getString: () => undefined },
}));
jest.mock('../secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => null), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../api', () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn() },
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
  getActiveFast: jest.fn(async () => null), getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined), endFast: jest.fn(async () => undefined),
}));
jest.mock('../../hooks/useVoiceUpload', () => ({ publishVoiceNote: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Directory: class { delete() {} }, File: class { delete() {} }, Paths: { document: 'file:///docs' },
}));

beforeEach(async () => {
  authEvents.emit('logout');
  resetVoiceOutbox();
  (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false });
  setSpaceOutboxOnline(false);
  await AsyncStorage.clear();
  await Promise.resolve();
  mockCache.clear();
});
afterEach(() => { authEvents.emit('logout'); resetVoiceOutbox(); });

it('LS942 control: with no unsent item the usual sign-out question is appropriate', async () => {
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('Are you sure you want to sign out?');
});

it.each(['text', 'voice'] as const)(
  'LS942 B3: an unsent space %s must be named before sign-out permanently removes it',
  async (kind) => {
    if (kind === 'text') {
      startSpaceOutbox('user-A');
      spaceOutbox.add('space', 'An offline space message');
      await Promise.resolve();
      expect(mockCache.get('space_outbox_user-A')).toContain('An offline space message');
    } else {
      await AsyncStorage.setItem('tgp.voiceOutbox.v1', JSON.stringify([{
        id: 'local-1793900000000-1', authorId: 'user-A', workspaceId: 'workspace',
        input: { cohortId: 'space', uri: 'file:///docs/voice-outbox/note.m4a', durationMs: 3000, bytes: 1000, mimeType: 'audio/mp4' },
        peaks: [], status: 'waiting',
      }]));
    }
    const confirmation = await prepareSignOutConfirm('user-A');
    // Complete the real destructive flow, not just a fabricated logout event.
    await signOut('user-A');
    expect(mockCache.get('space_outbox_user-A')).toBeUndefined();
    expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceOutbox.v1')) ?? '[]')).toEqual([]);
    expect(confirmation).toBe('1 message has not synced yet and will be removed from this phone.');
  },
);
