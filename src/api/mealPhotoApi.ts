// MEAL-PHOTO-M: the phone's half of b#1237's meal photo routes (CONTRACT 6758071921; backend log.controller.ts:78-91).
// The JPEG goes straight to the upload link the server minted for this client, with the one transfer the app already
// has (coachMediaApi.ts), then is attached to one of the client's own food entries. The link, the key and the file are
// never logged or sent anywhere else.
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import api from '../services/api';

/** Backend IMAGE_MAX_BYTES (community-image-store.ts:35) and AttachMealPhotoDto's sides of 1 to 10000 (meal-photo.dto.ts). */
export const MEAL_PHOTO_MAX_BYTES = 10_485_760;
export const MEAL_PHOTO_MAX_SIDE = 10_000;

export interface MealPhotoLink {
  key: string;
  /** expires_at as epoch ms: the key attaches within 600 s of minting. */
  expiresAt: number;
}

export class MealPhotoUploadError extends Error {}

export const mealPhotoApi = {
  /** POST /log/food/photo/upload-url, then one PUT of the file's bytes to the minted link. */
  async upload(uri: string, sizeBytes: number): Promise<MealPhotoLink> {
    const { data } = await api.post<{ upload_url: string; key: string; expires_at: string }>(
      '/log/food/photo/upload-url',
      { mime: 'image/jpeg', size_bytes: sizeBytes },
    );
    const status = await uploadAsync(data.upload_url, uri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    }).then(
      (res) => res.status,
      () => 0,
    );
    if (status < 200 || status >= 300) throw new MealPhotoUploadError('The upload did not finish.');
    return { key: data.key, expiresAt: Date.parse(data.expires_at) };
  },

  /** PUT /log/food/:id/photo with the key and the photo's real pixel size (LS-1237R1 N2). */
  attach: (entryId: string, photo: { key: string; width: number; height: number }) =>
    api.put(`/log/food/${encodeURIComponent(entryId)}/photo`, photo),
};
