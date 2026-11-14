/**
 * MEAL-PHOTO-M: the photo of a meal the open Add sheet keeps, in memory only, for the first food the client then logs
 * online to that sheet's meal and day (R5). It is let go when the sheet closes, at a sign-out or sign-in, and after its
 * attach, and the picker's file is deleted then too (R7). No food save waits on, fails with or changes because of it.
 */
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { deleteAsync, getInfoAsync } from 'expo-file-system/legacy';
import { mealPhotoApi, MEAL_PHOTO_MAX_BYTES, MEAL_PHOTO_MAX_SIDE, type MealPhotoLink } from '../../api/mealPhotoApi';
import { useClientStore } from '../../store/clientStore';
import { authEvents } from '../authEvents';
import { dayForNewLog } from '../logDay';

export type MealPhotoSource = 'camera' | 'library';

/**
 * R3: a still photo, unedited, written as a new JPEG at 0.8 from its pixels (quality under 1 is what makes iOS re-encode
 * instead of copying the original, expo-image-picker 56.0.25 MediaHandler.swift:75, :129-131), no EXIF read back, and
 * an iPhone HEIC handed over as JPEG.
 */
export const MEAL_PHOTO_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.8,
  exif: false,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

interface Kept {
  uri: string;
  width: number;
  height: number;
  size: number;
  date: string;
  mealType: string;
  /** The upload, started at the pick: its key, or null when it failed. */
  link: Promise<MealPhotoLink | null>;
}

let kept: Kept | null = null;
let sheet = 0; // moves on at every drop: a pick that ends after it lets its photo go
let account = 0; // moves on at sign-out and sign-in: an attach begun for the last account stops
let busy = false;

const forget = (uri: string) => {
  void (async () => {
    try {
      await deleteAsync(uri, { idempotent: true });
    } catch {
      // Already gone; the picker's cache folder is the system's to clear.
    }
  })();
};

/** The sheet closed or the account changed: nothing kept outlives it (R7). */
export function dropMealPhoto(): void {
  sheet += 1;
  const was = kept;
  kept = null;
  if (was) forget(was.uri);
}

const accountChanged = () => {
  account += 1;
  dropMealPhoto();
};
authEvents.on('logout', accountChanged);
authEvents.on('login', accountChanged);

/** True while a pick or its upload runs: the tile's second tap starts nothing (KT-3). */
export const mealPhotoBusy = (): boolean => busy;

const notAdded = (message: string) => Alert.alert('Photo not added', message);

async function sizeOf(uri: string): Promise<number> {
  try {
    const info = await getInfoAsync(uri);
    return info.exists ? info.size : 0;
  } catch {
    return 0;
  }
}

const within = (n: number, max: number) => n >= 1 && n <= max;

/** One pick for the sheet's meal: checked, then uploaded at once and kept (R4). A new pick replaces the kept one. */
export async function chooseMealPhoto(mealType: string, source: MealPhotoSource): Promise<void> {
  if (busy) return;
  busy = true;
  const mine = sheet;
  try {
    if (source === 'camera') {
      const access = await ImagePicker.requestCameraPermissionsAsync();
      if (!access.granted) {
        Alert.alert('Camera access is off', 'Turn it on in Settings to take a photo of a meal.', access.canAskAgain
          ? [{ text: 'OK' }]
          : [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } }]);
        return;
      }
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(MEAL_PHOTO_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(MEAL_PHOTO_OPTIONS);
    } catch {
      notAdded('The request could not be completed. Try again in a moment.');
      return;
    }
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    // The size of the written file itself (Android reports the source's), and the real pixel size (LS-1237R1 N2).
    const size = await sizeOf(asset.uri);
    const width = Math.round(asset.width);
    const height = Math.round(asset.height);
    if (sheet !== mine) {
      forget(asset.uri);
      return;
    }
    // Only a re-encoded JPEG leaves the phone: a source the picker passes through (TIFF, AVIF, WEBP, BMP, an
    // untranscoded HEIC) or writes as PNG or GIF is refused here (R3 table), as is anything over the server's limits.
    if (asset.mimeType !== 'image/jpeg' || !within(size, MEAL_PHOTO_MAX_BYTES)
      || !within(width, MEAL_PHOTO_MAX_SIDE) || !within(height, MEAL_PHOTO_MAX_SIDE)) {
      forget(asset.uri);
      notAdded("This photo can't be used. Take a new photo or choose another one.");
      return;
    }
    if (kept) forget(kept.uri); // its uploaded copy is left to the server's image_upload erasure
    const { selectedDate, selectedOn } = useClientStore.getState();
    const photo: Kept = {
      uri: asset.uri, width, height, size, mealType,
      date: dayForNewLog({ selectedDate, selectedOn }),
      link: mealPhotoApi.upload(asset.uri, size).catch(() => null),
    };
    kept = photo;
    // Uploaded, or let go meanwhile, or already taken by a save (whose attach reports any failure).
    if ((await photo.link) || kept !== photo) return;
    kept = null;
    forget(photo.uri);
    notAdded('The upload did not finish. Check the connection and try again.');
  } finally {
    busy = false;
  }
}

const codeOf = (err: unknown): unknown =>
  (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;

/**
 * R5: logSubmit's two online saves call this once POST /log/food has answered. It never throws and is never awaited,
 * so each save settles as it did before. The first food logged to the kept photo's meal and day takes the photo.
 */
export function mealPhotoAfterSave(log: { date: string; meal_type: string }, entryId: string | null): void {
  const photo = kept;
  if (!photo || !entryId || photo.date !== log.date || photo.mealType !== log.meal_type) return;
  kept = null;
  void attach(photo, entryId, account);
}

async function attach(photo: Kept, entryId: string, mine: number): Promise<void> {
  let renewed = false;
  // Past the link's 600 s window, or refused as key_invalid: one new link and one new upload of the kept file.
  const renew = () => {
    renewed = true;
    return mealPhotoApi.upload(photo.uri, photo.size);
  };
  const send = (link: MealPhotoLink) =>
    mealPhotoApi.attach(entryId, { key: link.key, width: photo.width, height: photo.height });
  try {
    let link = await photo.link;
    if (!link) throw new Error('not uploaded');
    if (Date.now() >= link.expiresAt) link = await renew();
    if (account !== mine) return;
    try {
      await send(link);
    } catch (err) {
      // 409 exists, has_location and every other refusal are final; key_invalid gets one new link.
      if (renewed || codeOf(err) !== 'log.photo.key_invalid') throw err;
      link = await renew();
      if (account !== mine) return;
      await send(link);
    }
  } catch {
    if (account === mine) Alert.alert('Photo not saved', 'Your food was added, but its photo was not saved.');
  } finally {
    forget(photo.uri);
  }
}
