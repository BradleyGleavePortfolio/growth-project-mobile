/**
 * MEAL-PHOTO-M (cases 3 and 9, the API half): the phone's calls to b#1237's meal photo routes. Every server answer below
 * is built from CONTRACT 6758071921 (growth-project-backend#1237): upload-url answers 201 {upload_url, key, expires_at},
 * the attach answers 200 {entry_id, photo}. Made-up links, keys and files only.
 */
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockUpload = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), put: (...a: unknown[]) => mockPut(...a) },
}));
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
}));

import { mealPhotoApi, MEAL_PHOTO_MAX_BYTES, MEAL_PHOTO_MAX_SIDE, MealPhotoUploadError } from '../mealPhotoApi';

const FILE = 'file:///cache/ImagePicker/made-up-meal.jpg';
// CONTRACT 6758071921 item 1: 201 {upload_url, key, expires_at (now + 600 s)}.
const minted = {
  upload_url: 'https://storage.example.test/upload/meal/made-up-key.jpg?token=made-up',
  key: 'meal/made-up-user/made-up-key.jpg',
  expires_at: '2026-11-14T06:10:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ status: 201, data: minted });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
});

it('the limits are the server\'s: IMAGE_MAX_BYTES 10,485,760 and AttachMealPhotoDto sides of 1 to 10000', () => {
  expect(MEAL_PHOTO_MAX_BYTES).toBe(10_485_760);
  expect(MEAL_PHOTO_MAX_SIDE).toBe(10_000);
});

it('case 3: one upload-url call with the JPEG mime and the byte size, then one PUT of the file to the minted link', async () => {
  const link = await mealPhotoApi.upload(FILE, 123_456);
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith('/log/food/photo/upload-url', { mime: 'image/jpeg', size_bytes: 123_456 });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledWith(minted.upload_url, FILE, {
    httpMethod: 'PUT',
    uploadType: 0,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  expect(link).toEqual({ key: minted.key, expiresAt: Date.parse(minted.expires_at) });
  // Nothing is attached by the upload.
  expect(mockPut).not.toHaveBeenCalled();
});

it.each([[0], [400], [403], [500]])('case 9: a PUT answered %s fails the upload', async (status) => {
  mockUpload.mockResolvedValue({ status, headers: {}, body: '' });
  await expect(mealPhotoApi.upload(FILE, 10)).rejects.toBeInstanceOf(MealPhotoUploadError);
});

it('case 9: a PUT that never connects fails the upload', async () => {
  mockUpload.mockRejectedValue(new Error('Network request failed'));
  await expect(mealPhotoApi.upload(FILE, 10)).rejects.toBeInstanceOf(MealPhotoUploadError);
});

it('case 9: upload-url 503 log.photo.storage_unavailable fails before any PUT', async () => {
  // CONTRACT 6758071921 item 1: 503 {error: "unavailable", code: "log.photo.storage_unavailable"}.
  mockPost.mockRejectedValue({ response: { status: 503, data: { error: 'unavailable', code: 'log.photo.storage_unavailable' } } });
  await expect(mealPhotoApi.upload(FILE, 10)).rejects.toBeTruthy();
  expect(mockUpload).not.toHaveBeenCalled();
});

it('the attach: PUT /log/food/:id/photo with the key and the pixel size, the id encoded (CONTRACT item 2)', async () => {
  mockPut.mockResolvedValue({ status: 200, data: { entry_id: 'e 1/x', photo: { url: null, width: 3024, height: 4032, expires_at: minted.expires_at } } });
  await mealPhotoApi.attach('e 1/x', { key: minted.key, width: 3024, height: 4032 });
  expect(mockPut).toHaveBeenCalledTimes(1);
  expect(mockPut).toHaveBeenCalledWith('/log/food/e%201%2Fx/photo', { key: minted.key, width: 3024, height: 4032 });
});
