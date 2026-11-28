/**
 * SC-M4 (agent 203), case T7's sign-out rows: a queue that is wiped is a queue that is counted (signOutQueues.ts:1-7).
 * The real sign-out confirm (services/authActions prepareSignOutConfirm -> sendUnsyncedLogs -> signOutQueues) counts this
 * account's photos the server has not taken and gives them one try; the real signOut wipes them and deletes their files.
 * Stand-ins as LS942SpaceSignOut.btest.test.ts has them, plus the picker, the file system and the API's POST.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const mockLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockLibrary(...a),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
}));
const mockInfo = jest.fn();
const mockDelete = jest.fn();
const mockUpload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  getInfoAsync: (...a: unknown[]) => mockInfo(...a),
  deleteAsync: (...a: unknown[]) => mockDelete(...a),
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
}));
const mockCache = new Map<string, string>();
jest.mock('../../../../storage/mmkv', () => ({
  clearAllStorage: jest.fn(async () => { mockCache.clear(); }),
  prefsStorage: { getString: () => undefined, getAllKeys: async () => [], delete: async () => undefined, set: async () => undefined },
  cacheStorage: {
    getString: (key: string) => mockCache.get(key),
    getStringAsync: async (key: string) => mockCache.get(key),
    getAllKeys: async () => [...mockCache.keys()],
    set: async (key: string, value: string) => { mockCache.set(key, value); },
    delete: async (key: string) => { mockCache.delete(key); },
  },
  secureStorage: { getString: () => undefined },
}));
jest.mock('../../../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async (k: string) => (k === 'supabase_token' ? 'tok-user-A' : null)), removeItem: jest.fn(async () => undefined) },
}));
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), get: jest.fn(async () => ({ data: {} })), delete: jest.fn(async () => ({ data: {} })) },
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
  foodApi: { create: jest.fn() }, logApi: { logFood: jest.fn() },
}));
jest.mock('../../../../services/sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn(), captureErrorWithoutPii: jest.fn() }));
jest.mock('../../../../lib/analytics', () => ({ reset: jest.fn(), track: jest.fn() }));
jest.mock('../../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'user-A' })),
  readUserCache: jest.fn(async () => ({ id: 'user-A' })),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
  countQueuedWorkouts: jest.fn(async () => 0),
  pushQueuedWorkouts: jest.fn(async () => undefined),
}));
jest.mock('../../../../db/fastingDb', () => ({
  getActiveFast: jest.fn(async () => null), getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined), endFast: jest.fn(async () => undefined),
}));
jest.mock('../../../../hooks/useVoiceUpload', () => ({ publishVoiceNote: jest.fn() }));
jest.mock('expo-file-system', () => ({
  Directory: class { delete() {} }, File: class { delete() {} }, Paths: { document: 'file:///docs' },
}));
jest.mock('../../../../store/clientStore', () => ({ useClientStore: { getState: () => ({}) } }));

import { Alert } from 'react-native';
import { prepareSignOutConfirm, signOut } from '../../../../services/authActions';
import { authEvents } from '../../../../utils/authEvents';
import { resetVoiceOutbox } from '../../../../hooks/useVoiceOutbox';
import { pickSpacePhoto } from '../spaceChatPhotos';

const FILE = 'file:///cache/ImagePicker/made-up-photo-1.jpg';
const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
let sendFails = true;
const net = (isConnected: boolean) => (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected, isInternetReachable: isConnected });
const photoSends = () => mockPost.mock.calls.filter(([u, b]) => String(u).endsWith('/messages') && (b as { kind?: string })?.kind === 'image');
const settle = async () => { for (let i = 0; i < 15; i += 1) await new Promise((r) => setTimeout(r, 0)); };
let alert: jest.SpyInstance;

beforeEach(async () => {
  authEvents.emit('logout');
  resetVoiceOutbox();
  [mockLibrary, mockInfo, mockUpload, mockDelete, mockPost].forEach((m) => m.mockReset());
  net(true);
  await AsyncStorage.clear();
  mockCache.clear();
  sendFails = true;
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
  mockInfo.mockResolvedValue({ exists: true, size: 2_000_000, uri: FILE, isDirectory: false, modificationTime: 1 });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  mockPost.mockImplementation(async (url: string) => {
    if (url.endsWith('/images/upload-url')) {
      return { status: 201, data: { upload_url: 'https://storage.example.test/upload/k1.jpg?token=made-up', key: 'made-up-user/c-a-k1.jpg', expires_at: new Date(Date.now() + 600_000).toISOString() } };
    }
    if (sendFails) throw fail(500);
    return { status: 201, data: { message: { id: 'srv-1', cohort_id: 'c-a', sender_user_id: 'user-A', body: null, kind: 'image', created_at: new Date().toISOString(), image: { url: null, width: 1200, height: 900 } } } };
  });
  // A photo the server has not taken: Not sent (its photo message answered 500).
  await pickSpacePhoto('c-a', 'user-A', true);
  await settle();
  expect(photoSends()).toHaveLength(1);
});
afterEach(() => { authEvents.emit('logout'); resetVoiceOutbox(); alert.mockRestore(); });

it('SCM4 T7: the sign-out confirm counts a photo still only on this phone, its one try finds no connection, and the sign-out wipes it and deletes its file', async () => {
  net(false);
  const confirmation = await prepareSignOutConfirm('user-A');
  expect(confirmation).toBe('1 message has not synced yet and will be removed from this phone.');
  expect(photoSends()).toHaveLength(1);
  await signOut('user-A');
  await settle();
  expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  net(true);
  await expect(prepareSignOutConfirm('user-A')).resolves.toBe('Are you sure you want to sign out?');
});

it('SCM4 T7: online, the one try sends it as this account (the same Idempotency-Key), so nothing is counted', async () => {
  sendFails = false;
  const confirmation = await prepareSignOutConfirm('user-A');
  expect(photoSends()).toHaveLength(2);
  const key = (c: unknown[]) => (c[2] as { headers: Record<string, string> }).headers['Idempotency-Key'];
  expect(key(photoSends()[1])).toBe(key(photoSends()[0]));
  expect(confirmation).toBe('Are you sure you want to sign out?');
});

it('SCM4 T7: another account signing out counts none of this account\'s photos', async () => {
  net(false);
  await expect(prepareSignOutConfirm('user-B')).resolves.toBe('Are you sure you want to sign out?');
});
