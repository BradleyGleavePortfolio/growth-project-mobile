/**
 * LS-SCM4-1 B1 (review round 1 of m#1020, the Fable lens): an iPhone screenshot is a PNG, and expo-image-picker 56.0.25
 * hands a PNG back as a PNG whatever the quality (ImageUtils.swift:130-132 at expo/expo 1b8eb0e1). The space chat's pick
 * refuses everything but image/jpeg (spaceChatPhotos.ts:236-241), so every screenshot a member picks ends in one alert,
 * "This photo can't be used. Choose another one.", which sends her to another photo and never says that no screenshot
 * can be posted. This case passes when a PNG pick is either sent, or told in words of its own (any line but that one).
 * Made-up bytes, files and links only; the stand-ins are SCM4PhotoSend.test.tsx's.
 */
import { Alert } from 'react-native';

const mockLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockLibrary(...a),
  launchCameraAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
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
  writeAsStringAsync: jest.fn(async () => undefined),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  cacheDirectory: 'file:///cache/',
}));
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), get: jest.fn(async () => ({ data: {} })), delete: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../../storage/mmkv', () => ({
  cacheStorage: { getString: () => undefined, getStringAsync: async () => undefined, set: async () => undefined, delete: async () => undefined, getAllKeys: async () => [] },
  prefsStorage: { getString: () => undefined, set: async () => undefined, delete: async () => undefined, getAllKeys: async () => [] },
}));
jest.mock('../../../../store/clientStore', () => ({ useClientStore: { getState: () => ({ selectedDate: '2026-11-27' }) } }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'me-1' }) }));
jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../../lib/analytics', () => ({ track: jest.fn() }));

import { authEvents } from '../../../../utils/authEvents';
import { pickSpacePhoto } from '../spaceChatPhotos';

const SCREENSHOT = 'file:///cache/ImagePicker/made-up-screenshot-1.png';
const ONLY_LINE = "This photo can't be used. Choose another one.";
const store = () => (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;
const settle = async () => { for (let i = 0; i < 15; i += 1) await new Promise((r) => setTimeout(r, 0)); };

let alert: jest.SpyInstance;
beforeEach(() => {
  authEvents.emit('logout');
  [mockLibrary, mockInfo, mockDelete, mockUpload, mockPost].forEach((m) => m.mockReset());
  store().set('supabase_token', 'tok-me-1');
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockInfo.mockResolvedValue({ exists: true, size: 1_400_000, uri: SCREENSHOT, isDirectory: false, modificationTime: 1 });
  mockDelete.mockResolvedValue(undefined);
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockPost.mockImplementation(async (url: string, body: { kind?: string }) => {
    if (url.endsWith('/images/upload-url')) {
      return { status: 201, data: { upload_url: 'https://storage.example.test/upload/k1.jpg?token=made-up', key: 'made-up-user/c-a-k1.jpg', expires_at: new Date(Date.now() + 600_000).toISOString() } };
    }
    if (url.endsWith('/messages') && body?.kind === 'image') {
      return { status: 201, data: { message: { id: 'srv-1', cohort_id: 'c-a', sender_user_id: 'me-1', body: null, kind: 'image', created_at: new Date().toISOString(), image: { url: null, width: 1179, height: 2556 } } } };
    }
    throw Object.assign(new Error('HTTP 500'), { isAxiosError: true, response: { status: 500, data: {} } });
  });
});
afterEach(() => {
  authEvents.emit('logout');
  alert.mockRestore();
});

it('LS-SCM4-1 B1: an iPhone screenshot (the picker hands a PNG back as a PNG) is sent, or she is told why in words of its own, never only "Choose another one."', async () => {
  // What the picker returns for a screenshot at quality 0.8 with the Compatible representation: a .png, image/png.
  mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: SCREENSHOT, width: 1179, height: 2556, mimeType: 'image/png', fileName: 'IMG_0001.png' }] });
  await pickSpacePhoto('c-a', 'me-1', true);
  await settle();
  const sent = mockPost.mock.calls.some(([u, b]) => String(u).endsWith('/messages') && (b as { kind?: string })?.kind === 'image');
  const told = alert.mock.calls.map(([, message]) => String(message ?? ''));
  expect(sent || told.some((m) => m !== '' && m !== ONLY_LINE)).toBe(true);
});
