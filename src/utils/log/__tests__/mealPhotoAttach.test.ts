/**
 * MEAL-PHOTO-M: the photo of a meal kept by the open Add sheet (src/utils/log/mealPhoto.ts) and the after-save step in
 * logSubmit.ts's two online saves. Cases 4-11 and 13 of the brief. Server answers are built from CONTRACT 6758071921
 * (growth-project-backend#1237): upload-url 201 {upload_url, key, expires_at}; the attach 200 {entry_id, photo}, or 404
 * "Entry not found", 409 log.photo.exists, 422 log.photo.<code>, 503 log.photo.storage_unavailable. Made-up bytes only.
 */
import { Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockCameraPermission = jest.fn();
const mockLibraryPermission = jest.fn();
const mockCamera = jest.fn();
const mockLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...a: unknown[]) => mockCameraPermission(...a),
  requestMediaLibraryPermissionsAsync: (...a: unknown[]) => mockLibraryPermission(...a),
  launchCameraAsync: (...a: unknown[]) => mockCamera(...a),
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
const mockCreate = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), put: (...a: unknown[]) => mockPut(...a) },
  foodApi: { create: (...a: unknown[]) => mockCreate(...a) },
  logApi: { logFood: (...a: unknown[]) => mockLogFood(...a) },
}));
const mockEnqueue = jest.fn();
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a) }));
const DAY = '2026-11-13';
jest.mock('../../../store/clientStore', () => ({ useClientStore: { getState: () => ({ selectedDate: '2026-11-13' }) } }));
jest.mock('../../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import { chooseMealPhoto, dropMealPhoto, mealPhotoAfterSave, MEAL_PHOTO_OPTIONS } from '../mealPhoto';
import { submitManualLogOnlineWithId, submitSearchLogOffline, submitSearchLogOnline } from '../logSubmit';
import { repeatPastMeal } from '../quickLog';
import { authEvents } from '../../authEvents';
import type { SearchResult } from '../types';

const FILE = 'file:///cache/ImagePicker/made-up-meal.jpg';
const FILE2 = 'file:///cache/ImagePicker/made-up-meal-2.jpg';
const T0 = Date.parse('2026-11-14T06:00:00.000Z');
// CONTRACT 6758071921 item 1: 201 {upload_url, key, expires_at (now + 600 s)}.
const minted = (n: number) => ({
  status: 201,
  data: { upload_url: `https://storage.example.test/upload/k${n}.jpg?token=made-up`, key: `meal/made-up-user/k${n}.jpg`,
    expires_at: new Date(T0 + 600_000).toISOString() },
});
const asset = (over: Record<string, unknown> = {}) => ({ uri: FILE, width: 3024, height: 4032, mimeType: 'image/jpeg', ...over });
const picked = (over: Record<string, unknown> = {}) => ({ canceled: false, assets: [asset(over)] });
const oats: SearchResult = { id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
  nutrient_basis: 'PER_100G', serving_size_grams: 40 } as SearchResult;
const search = (over: Record<string, unknown> = {}) =>
  ({ food: oats, date: DAY, mealType: 'lunch' as const, multiplier: 0.4, originalQuantity: 40, originalUnit: 'g', ...over });
const manual = (over: Record<string, unknown> = {}) => ({ foodName: 'Soup', calories: '210', protein: '9', carbs: '20', fat: '8',
  quantity: '1', unit: 'serving', date: DAY, mealType: 'lunch' as const, ...over });
const attachCalls = () => mockPut.mock.calls.filter(([url]) => /^\/log\/food\/.+\/photo$/.test(String(url)));
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const never = () => new Promise(() => undefined);
let alert: jest.SpyInstance;
let now: jest.SpyInstance;

/** A library pick of a made-up JPEG, uploaded and kept for `mealType` on DAY. */
async function keep(mealType = 'lunch', over: Record<string, unknown> = {}, size = 2_000_000) {
  mockLibrary.mockResolvedValueOnce(picked(over));
  mockInfo.mockResolvedValueOnce({ exists: true, size, uri: String(over.uri ?? FILE), isDirectory: false, modificationTime: 1 });
  await chooseMealPhoto(mealType, 'library');
}

beforeEach(() => {
  dropMealPhoto();
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  now = jest.spyOn(Date, 'now').mockReturnValue(T0);
  let n = 0;
  mockPost.mockImplementation(async () => { n += 1; return minted(n); });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  mockPut.mockResolvedValue({ status: 200, data: { entry_id: 'entry-1', photo: { url: null, width: 3024, height: 4032 } } });
  mockLogFood.mockResolvedValue({ status: 201, data: { id: 'entry-1' } });
  mockCreate.mockResolvedValue({ data: { id: 'food-1' } });
  mockEnqueue.mockResolvedValue(undefined);
  mockCameraPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
});
afterEach(() => { alert.mockRestore(); now.mockRestore(); });

describe('case 5: the picker options (R3)', () => {
  it('images only, no editing, quality 0.8, no EXIF read back, HEIC handed over as JPEG', async () => {
    await keep();
    expect(MEAL_PHOTO_OPTIONS).toEqual({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8, exif: false,
      preferredAssetRepresentationMode: 'compatible' });
    expect(mockLibrary).toHaveBeenCalledWith(MEAL_PHOTO_OPTIONS);
    const [opts] = mockLibrary.mock.calls[0];
    // quality < 1 is what makes iOS re-encode (MediaHandler.swift:75, :129-131); 1 would copy the original file.
    expect(opts.quality).toBeLessThan(1);
    expect(opts.exif).toBe(false);
    expect(opts.allowsEditing).toBe(false);
    expect(opts.mediaTypes).toEqual(['images']);
  });

  it('the camera gets the same options, after the camera permission', async () => {
    mockCamera.mockResolvedValueOnce(picked());
    mockInfo.mockResolvedValueOnce({ exists: true, size: 10, uri: FILE, isDirectory: false, modificationTime: 1 });
    await chooseMealPhoto('lunch', 'camera');
    expect(mockCameraPermission).toHaveBeenCalledTimes(1);
    expect(mockCamera).toHaveBeenCalledTimes(1);
    expect(mockCamera).toHaveBeenCalledWith(MEAL_PHOTO_OPTIONS);
    expect(mockLibrary).not.toHaveBeenCalled();
  });
});

describe('case 4: the first food logged online to that meal and day takes the photo', () => {
  it('a search, Recent or Frequent pick: POST /log/food as before, then one PUT /log/food/<id>/photo with the pixel size', async () => {
    await keep();
    expect(mockPost).toHaveBeenCalledWith('/log/food/photo/upload-url', { mime: 'image/jpeg', size_bytes: 2_000_000 });
    expect(attachCalls()).toHaveLength(0);
    await submitSearchLogOnline(search());
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    const [body] = mockLogFood.mock.calls[0];
    // The food save's body is base's: the log fields and the save's own key, nothing about the photo.
    expect(Object.keys(body).sort()).toEqual(['client_uuid', 'date', 'food_item_id', 'meal_type', 'original_quantity',
      'original_unit', 'quantity_multiplier']);
    expect(body).toMatchObject({ date: DAY, meal_type: 'lunch', food_item_id: 'oats', quantity_multiplier: 0.4 });
    expect(body.client_uuid).toMatch(/^pfl_/);
    await settle();
    expect(attachCalls()).toEqual([['/log/food/entry-1/photo', { key: 'meal/made-up-user/k1.jpg', width: 3024, height: 4032 }]]);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });

  it('Quick add (submitManualLogOnlineWithId) the same, and its answer is unchanged', async () => {
    await keep();
    mockLogFood.mockResolvedValueOnce({ status: 201, data: { id: 'entry-2' } });
    await expect(submitManualLogOnlineWithId(manual())).resolves.toEqual({ name: 'Soup', entryId: 'entry-2' });
    await settle();
    expect(attachCalls()).toEqual([['/log/food/entry-2/photo', { key: 'meal/made-up-user/k1.jpg', width: 3024, height: 4032 }]]);
  });

  it('a second food logged to that meal does not attach', async () => {
    await keep();
    await submitSearchLogOnline(search());
    await settle();
    mockLogFood.mockResolvedValueOnce({ status: 201, data: { id: 'entry-3' } });
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(1);
  });

  it('a save answered before the upload ended still takes the photo once the upload ends', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mockUpload.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const choosing = keep();
    await settle();
    await submitSearchLogOnline(search());
    expect(attachCalls()).toHaveLength(0);
    finish({ status: 200, headers: {}, body: '' });
    await choosing;
    await settle();
    expect(attachCalls()).toHaveLength(1);
  });
});

describe('case 6: refused before the upload', () => {
  it.each([
    ['a file over 10,485,760 bytes', {}, 10_485_761],
    ['an empty file', {}, 0],
    ['a side over 10000', { width: 10_001 }, 2_000],
    ['a side under 1', { height: 0 }, 2_000],
    ['a PNG', { mimeType: 'image/png' }, 2_000],
    ['an original HEIC', { mimeType: 'image/heic' }, 2_000],
  ])('%s: no upload, the alert, the file deleted, nothing kept', async (_n, over, size) => {
    await keep('lunch', over, size);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Photo not added', "This photo can't be used. Take a new photo or choose another one.");
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(0);
  });

  it('10,485,760 bytes and sides of 10000 are kept', async () => {
    await keep('lunch', { width: 10_000, height: 10_000 }, 10_485_760);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('camera refused: no camera, the alert; a later tap asks again', async () => {
    mockCameraPermission.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'denied' });
    await chooseMealPhoto('lunch', 'camera');
    expect(mockCamera).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Camera access is off', 'Turn it on in Settings to take a photo of a meal.', [{ text: 'OK' }]);
    mockCamera.mockResolvedValueOnce({ canceled: true, assets: null });
    await chooseMealPhoto('lunch', 'camera');
    expect(mockCameraPermission).toHaveBeenCalledTimes(2);
    expect(mockCamera).toHaveBeenCalledTimes(1);
  });

  it('camera refused for good: the alert offers Open Settings (the microphone\'s words)', async () => {
    mockCameraPermission.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
    await chooseMealPhoto('lunch', 'camera');
    const [title, body, buttons] = alert.mock.calls[0];
    expect([title, body]).toEqual(['Camera access is off', 'Turn it on in Settings to take a photo of a meal.']);
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Not now', 'Open Settings']);
    buttons[1].onPress();
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(mockCamera).not.toHaveBeenCalled();
  });

  it('the library asks no permission (the system photo picker); a picker that cannot open: the alert, nothing kept', async () => {
    mockLibrary.mockRejectedValueOnce(new Error('made-up picker failure'));
    await chooseMealPhoto('lunch', 'library');
    expect(mockLibraryPermission).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Photo not added', 'The request could not be completed. Try again in a moment.');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('a cancelled pick starts nothing and keeps nothing', async () => {
    mockLibrary.mockResolvedValueOnce({ canceled: true, assets: null });
    await chooseMealPhoto('lunch', 'library');
    expect(mockPost).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(0);
  });
});

describe('case 7: the food save is untouched by the photo', () => {
  const refusals: Array<[string, unknown]> = [
    ['404 Entry not found', { response: { status: 404, data: { message: 'Entry not found' } } }],
    ['409 log.photo.exists', { response: { status: 409, data: { error: 'conflict', code: 'log.photo.exists' } } }],
    ...['key_used', 'missing', 'not_jpeg', 'too_large', 'has_location'].map((c): [string, unknown] =>
      [`422 log.photo.${c}`, { response: { status: 422, data: { error: 'invalid_image', code: `log.photo.${c}` } } }]),
    ['503 log.photo.storage_unavailable', { response: { status: 503, data: { error: 'unavailable', code: 'log.photo.storage_unavailable' } } }],
    ['no answer at all', { message: 'Network Error', code: 'ERR_NETWORK' }],
  ];
  it.each(refusals)('%s: the food stays logged, one alert, never retried', async (_n, refusal) => {
    await keep();
    mockPut.mockRejectedValueOnce(refusal);
    await expect(submitSearchLogOnline(search())).resolves.toBeUndefined();
    await settle();
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    expect(attachCalls()).toHaveLength(1);
    expect(mockPost).toHaveBeenCalledTimes(1); // no new link, no second upload
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Photo not saved', 'Your food was added, but its photo was not saved.');
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });

  it('an attach that never answers: both online saves settle as before', async () => {
    mockPut.mockImplementation(never);
    await keep();
    await expect(submitSearchLogOnline(search())).resolves.toBeUndefined();
    await keep();
    mockLogFood.mockResolvedValueOnce({ status: 201, data: { id: 'entry-9' } });
    await expect(submitManualLogOnlineWithId(manual())).resolves.toEqual({ name: 'Soup', entryId: 'entry-9' });
    expect(alert).not.toHaveBeenCalled();
  });

  it('a failed food save fails exactly as before and attaches nothing', async () => {
    await keep();
    const lost = { response: { status: 500 } };
    mockLogFood.mockRejectedValueOnce(lost);
    await expect(submitSearchLogOnline(search())).rejects.toBe(lost);
    await settle();
    expect(attachCalls()).toHaveLength(0);
  });

  it('an answer without an id attaches nothing', async () => {
    await keep();
    mockLogFood.mockResolvedValueOnce({ status: 201, data: {} });
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(0);
  });
});

describe('case 8: the 600 s window', () => {
  it('after expires_at: one new upload-url, one new PUT of the kept file, one attach', async () => {
    await keep();
    now.mockReturnValue(T0 + 600_000);
    await submitSearchLogOnline(search());
    await settle();
    expect(mockPost.mock.calls.filter(([u]) => u === '/log/food/photo/upload-url')).toHaveLength(2);
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpload.mock.calls[1][1]).toBe(FILE);
    expect(attachCalls()).toEqual([['/log/food/entry-1/photo', { key: 'meal/made-up-user/k2.jpg', width: 3024, height: 4032 }]]);
    expect(alert).not.toHaveBeenCalled();
  });

  it('422 log.photo.key_invalid: one new upload-url, one new PUT, one attach', async () => {
    await keep();
    mockPut.mockRejectedValueOnce({ response: { status: 422, data: { error: 'invalid_image', code: 'log.photo.key_invalid' } } });
    await submitSearchLogOnline(search());
    await settle();
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(attachCalls().map(([, b]) => b.key)).toEqual(['meal/made-up-user/k1.jpg', 'meal/made-up-user/k2.jpg']);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a second key_invalid: the alert, nothing more', async () => {
    await keep();
    const invalid = { response: { status: 422, data: { error: 'invalid_image', code: 'log.photo.key_invalid' } } };
    mockPut.mockRejectedValueOnce(invalid).mockRejectedValueOnce(invalid);
    await submitSearchLogOnline(search());
    await settle();
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(attachCalls()).toHaveLength(2);
    expect(alert).toHaveBeenCalledWith('Photo not saved', 'Your food was added, but its photo was not saved.');
  });

  it('past expires_at and then key_invalid: no third upload', async () => {
    await keep();
    now.mockReturnValue(T0 + 601_000);
    mockPut.mockRejectedValueOnce({ response: { status: 422, data: { error: 'invalid_image', code: 'log.photo.key_invalid' } } });
    await submitSearchLogOnline(search());
    await settle();
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(attachCalls()).toHaveLength(1);
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

describe('case 9: an upload that fails keeps nothing', () => {
  it.each([
    ['the PUT answers 403', () => mockUpload.mockResolvedValueOnce({ status: 403, headers: {}, body: '' })],
    ['the PUT never connects', () => mockUpload.mockRejectedValueOnce(new Error('Network request failed'))],
    ['upload-url answers 503', () => mockPost.mockRejectedValueOnce({ response: { status: 503, data: { code: 'log.photo.storage_unavailable' } } })],
    ['no network for upload-url', () => mockPost.mockRejectedValueOnce({ message: 'Network Error', code: 'ERR_NETWORK' })],
  ])('%s: the alert, the file deleted, and the next food logs as before with no attach', async (_n, fail) => {
    fail();
    await keep();
    expect(alert).toHaveBeenCalledWith('Photo not added', 'The upload did not finish. Check the connection and try again.');
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    await submitSearchLogOnline(search());
    await settle();
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    expect(attachCalls()).toHaveLength(0);
  });
});

describe('case 10: nothing about the photo outlives the sheet that kept it', () => {
  it('the sheet closed before a food: nothing attaches later, even in a newly opened sheet; the file is deleted', async () => {
    await keep();
    dropMealPhoto();
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    await submitSearchLogOnline(search());
    await submitManualLogOnlineWithId(manual());
    await settle();
    expect(attachCalls()).toHaveLength(0);
  });

  it.each(['logout', 'login'])('%s: the kept photo is let go and its file deleted', async (event) => {
    await keep();
    authEvents.emit(event);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(0);
  });

  it('an upload still running when the sheet closes keeps nothing when it ends', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mockUpload.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const choosing = keep();
    await settle();
    dropMealPhoto();
    finish({ status: 200, headers: {}, body: '' });
    await choosing;
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it('an attach already started survives the sheet closing, but stops at a sign-out', async () => {
    await keep();
    await submitSearchLogOnline(search());
    dropMealPhoto();
    await settle();
    expect(attachCalls()).toHaveLength(1);

    await keep();
    now.mockReturnValue(T0 + 600_000); // the attach must renew first
    let finish: (v: unknown) => void = () => undefined;
    mockUpload.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    await submitSearchLogOnline(search());
    await settle();
    authEvents.emit('logout');
    finish({ status: 200, headers: {}, body: '' });
    await settle();
    expect(attachCalls()).toHaveLength(1);
  });

  it('nothing is written to AsyncStorage or the food queue', async () => {
    const set = jest.spyOn(AsyncStorage, 'setItem');
    await keep();
    await submitSearchLogOnline(search());
    await settle();
    expect(set).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('case 11: saves that never take the photo', () => {
  it('an offline (queued) save: queued as before, and the photo stays kept for the next online food', async () => {
    await keep();
    await submitSearchLogOffline(search());
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    await settle();
    expect(attachCalls()).toHaveLength(0);
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(1);
  });

  it('Repeat (quickLog) saves as before and does not attach', async () => {
    await keep();
    await repeatPastMeal({ date: '2026-11-12', calories: 300, entries: [{ foodItemId: 'gy', name: 'Greek yoghurt', calories: 118, quantityMultiplier: 2 }] }, DAY, 'lunch');
    await settle();
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    expect(attachCalls()).toHaveLength(0);
  });

  it.each([
    ['another meal (the Extras meal choice)', { mealType: 'dinner' }],
    ['another day', { date: '2026-11-12' }],
  ])('%s: saved as before, no attach, the photo stays kept', async (_n, over) => {
    await keep();
    await submitSearchLogOnline(search(over));
    await submitManualLogOnlineWithId(manual(over));
    await settle();
    expect(attachCalls()).toHaveLength(0);
    await submitSearchLogOnline(search());
    await settle();
    expect(attachCalls()).toHaveLength(1);
  });

  it('a plan meal (LogPlannedMealButton): logged only while no sheet is open, so nothing is kept to attach', async () => {
    await keep();
    dropMealPhoto(); // the sheet is hidden before the meal plan screen can be tapped
    mockLogFood.mockResolvedValueOnce({ status: 201, data: { id: 'entry-plan' } });
    await expect(submitManualLogOnlineWithId(manual({ link: { planSlotId: 'slot-1' } }))).resolves.toEqual({ name: 'Soup', entryId: 'entry-plan' });
    await settle();
    expect(attachCalls()).toHaveLength(0);
  });

  it('mealPhotoAfterSave with nothing kept is a no-op', () => {
    expect(() => mealPhotoAfterSave({ date: DAY, meal_type: 'lunch' }, 'entry-1')).not.toThrow();
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('case 13: no egress', () => {
  it('the upload link, the key and the file never reach the logger, Sentry, analytics or the console', async () => {
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    await keep();
    await submitSearchLogOnline(search());
    await settle();
    await keep();
    mockPut.mockRejectedValueOnce({ response: { status: 422, data: { code: 'log.photo.has_location' } } });
    await submitSearchLogOnline(search());
    await settle();
    mockUpload.mockResolvedValueOnce({ status: 500, headers: {}, body: '' });
    await keep();
    const secrets = [FILE, 'storage.example.test', 'made-up-user', 'k1.jpg', 'k2.jpg', 'k3.jpg', 'token=made-up'];
    const { logger } = jest.requireMock('../../logger');
    const sentry = jest.requireMock('../../../services/sentry');
    const { track } = jest.requireMock('../../../lib/analytics');
    const writes = [...Object.values(logger), ...Object.values(sentry), track, ...consoles]
      .flatMap((f) => (f as jest.Mock).mock.calls.map((c) => JSON.stringify(c)));
    expect(writes.filter((w) => secrets.some((s) => w.includes(s)))).toEqual([]);
    consoles.forEach((c) => c.mockRestore());
  });
});
