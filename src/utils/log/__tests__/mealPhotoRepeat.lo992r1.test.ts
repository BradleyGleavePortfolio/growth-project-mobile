/**
 * LO-992R1 B1 (B-TEST, lens): a photo kept by the open Add sheet for a meal and day, then that meal logged with Repeat.
 * Repeat is offered on the sheet only while the meal is still empty (LogScreen.tsx:449-454), the moment a client takes
 * a photo of that meal, and on success it closes the sheet (LogScreen.tsx:504), which lets the kept photo go
 * (FoodSearchModal.tsx:144). The tile's spoken hint (MP-W2) says the photo is kept "with the next food you add", and the
 * PR body's "What users will see" says the next food logged to that meal online keeps it. At ca5d980d Repeat's online
 * save never takes it (quickLog.ts repeatPastMeal), so the photo is let go with no word. Harness: mealPhotoAttach.test.ts's.
 * Made-up files and ids only.
 */
import { Alert } from 'react-native';

const mockLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
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
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockLogFood = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), put: (...a: unknown[]) => mockPut(...a) },
  foodApi: { create: jest.fn() },
  logApi: { logFood: (...a: unknown[]) => mockLogFood(...a) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));
const DAY = '2026-11-13';
jest.mock('../../../store/clientStore', () => ({ useClientStore: { getState: () => ({ selectedDate: '2026-11-13' }) } }));
jest.mock('../../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import { chooseMealPhoto, dropMealPhoto } from '../mealPhoto';
import { repeatPastMeal } from '../quickLog';

const FILE = 'file:///cache/ImagePicker/made-up-meal.jpg';
const T0 = Date.parse('2026-11-14T06:00:00.000Z');
const attachCalls = () => mockPut.mock.calls.filter(([url]) => /^\/log\/food\/.+\/photo$/.test(String(url)));
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const yesterdaysLunch = {
  date: '2026-11-12',
  calories: 418,
  entries: [
    { foodItemId: 'gy', name: 'Greek yoghurt', calories: 118, quantityMultiplier: 2 },
    { foodItemId: 'oats', name: 'Rolled oats', calories: 300, quantityMultiplier: 1 },
  ],
};
let now: jest.SpyInstance;
let alert: jest.SpyInstance;

beforeEach(() => {
  dropMealPhoto();
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  now = jest.spyOn(Date, 'now').mockReturnValue(T0);
  mockPost.mockResolvedValue({ status: 201, data: { upload_url: 'https://storage.example.test/upload/k1.jpg?token=made-up',
    key: 'meal/made-up-user/k1.jpg', expires_at: new Date(T0 + 600_000).toISOString() } });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  mockPut.mockResolvedValue({ status: 200, data: { entry_id: 'entry-r1', photo: { url: null, width: 3024, height: 4032 } } });
  mockLogFood
    .mockResolvedValueOnce({ status: 201, data: { id: 'entry-r1' } })
    .mockResolvedValueOnce({ status: 201, data: { id: 'entry-r2' } });
  mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: FILE, width: 3024, height: 4032, mimeType: 'image/jpeg' }] });
  mockInfo.mockResolvedValueOnce({ exists: true, size: 2_000_000, uri: FILE, isDirectory: false, modificationTime: 1 });
});
afterEach(() => { alert.mockRestore(); now.mockRestore(); });

it('B1: a photo kept for lunch, then Repeat logs lunch online: one food Repeat logged takes the photo (one PUT /log/food/<id>/photo)', async () => {
  await chooseMealPhoto('lunch', 'library');
  expect(mockUpload).toHaveBeenCalledTimes(1);

  await repeatPastMeal(yesterdaysLunch, DAY, 'lunch');
  await settle();

  expect(mockLogFood).toHaveBeenCalledTimes(2);
  const attaches = attachCalls();
  expect(attaches).toHaveLength(1);
  expect(['/log/food/entry-r1/photo', '/log/food/entry-r2/photo']).toContain(attaches[0][0]);
  expect(attaches[0][1]).toEqual({ key: 'meal/made-up-user/k1.jpg', width: 3024, height: 4032 });
});
