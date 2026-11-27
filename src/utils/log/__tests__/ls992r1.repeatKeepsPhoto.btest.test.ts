/**
 * LS-992R1 B1 (B-TEST, fails at ca5d980df21933431546a2a66d49b7f81dd9f9c3): Repeat with a kept photo.
 *
 * The Add sheet shows "Photo of a meal" and the "Repeat {day}'s {meal}" card together (FoodSearchView.tsx:145-177 and
 * :209-232: both show while the search is empty, and the card shows exactly when the meal is still empty). A client who
 * takes a photo and then taps "Add all" gets every food logged (LogScreen.tsx:499 -> quickLog.ts:64-86), the sheet closes
 * (LogScreen.tsx:504 -> FoodSearchModal.tsx:144 -> dropMealPhoto) and the photo is let go with no word: nothing attaches
 * and no alert shows. The tile's own spoken hint (MP-W2) says the photo is kept "with the next food you add".
 *
 * Held here: one of the repeated foods takes the kept photo. Made-up files, links and keys only.
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

import { chooseMealPhoto, dropMealPhoto } from '../mealPhoto';
import { repeatPastMeal } from '../quickLog';

const FILE = 'file:///cache/ImagePicker/made-up-meal.jpg';
const attachCalls = () => mockPut.mock.calls.filter(([url]) => /^\/log\/food\/.+\/photo$/.test(String(url)));
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const yesterdayLunch = {
  date: '2026-11-12',
  calories: 520,
  entries: [
    { foodItemId: 'made-up-rice', name: 'Rice', calories: 260, quantityMultiplier: 2 },
    { foodItemId: 'made-up-chicken', name: 'Chicken', calories: 260, quantityMultiplier: 1.5 },
  ],
};
let alert: jest.SpyInstance;

beforeEach(() => {
  dropMealPhoto();
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: FILE, width: 3024, height: 4032, mimeType: 'image/jpeg' }] });
  mockInfo.mockResolvedValue({ exists: true, size: 2_000_000, uri: FILE, isDirectory: false, modificationTime: 1 });
  mockPost.mockResolvedValue({ status: 201, data: { upload_url: 'https://storage.example.test/up?token=made-up',
    key: 'meal/made-up-user/k1.jpg', expires_at: new Date(Date.now() + 600_000).toISOString() } });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  mockPut.mockResolvedValue({ status: 200, data: { entry_id: 'entry-r1', photo: null } });
  let n = 0;
  mockLogFood.mockImplementation(async () => { n += 1; return { status: 201, data: { id: `entry-r${n}` } }; });
});
afterEach(() => alert.mockRestore());

it('LS-992R1 B1: a photo kept by the sheet goes with a food of the meal the client then repeats ("Add all")', async () => {
  await chooseMealPhoto('lunch', 'library');
  expect(mockUpload).toHaveBeenCalledTimes(1); // the photo is uploaded and kept for lunch

  const result = await repeatPastMeal(yesterdayLunch, DAY, 'lunch');
  expect(result).toEqual({ added: 2, failedNames: [] }); // both foods saved, as before
  dropMealPhoto(); // the sheet closes after a full repeat (LogScreen.tsx:504)
  await settle();

  expect(attachCalls()).toHaveLength(1);
  const [url, body] = attachCalls()[0];
  expect(String(url)).toMatch(/^\/log\/food\/entry-r[12]\/photo$/);
  expect(body).toEqual({ key: 'meal/made-up-user/k1.jpg', width: 3024, height: 4032 });
  expect(alert).not.toHaveBeenCalled();
});
