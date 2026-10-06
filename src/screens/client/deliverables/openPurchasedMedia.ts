/**
 * Opens a purchased PDF or video (B-DELIV-125, B3).
 *
 * A delivered pdf / video drop carries the CoachMediaAsset id in
 * `asset_id` (NOT `materialised_ref`, which is the ClientAssetGrant id).
 * The backend signs a short-lived URL only for the buyer who holds a live
 * grant for that asset:
 *
 *   GET /v1/client/media/:assetId/signed-url → { url, expires_in_seconds, kind }
 *     404 → no live grant for this account (or a backend that predates the
 *           route), 409 → the file is still processing.
 *
 * The URL opens in the system in-app browser, which renders PDFs and plays
 * the signed video stream. Every failure becomes a specific message; a raw
 * transport error never reaches the buyer.
 */

import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import api from '../../../services/api';

export type PurchasedMediaFailure = 'not_ready' | 'unavailable' | 'network';

export type PurchasedMediaLink =
  | { ok: true; url: string }
  | { ok: false; reason: PurchasedMediaFailure };

export const PURCHASED_MEDIA_COPY: Record<
  PurchasedMediaFailure | 'viewer',
  { title: string; message: string }
> = {
  not_ready: {
    title: 'Still processing',
    message: 'This file is still being prepared. Try again in a few minutes.',
  },
  unavailable: {
    title: 'File not available',
    message:
      'This file cannot be opened on this account right now. If it came with your purchase, message your coach.',
  },
  network: {
    title: 'Could not open file',
    message: 'Check your connection and try again.',
  },
  viewer: {
    title: 'Could not open file',
    message: 'The file viewer did not start. Try again.',
  },
};

export async function fetchPurchasedMediaLink(
  mediaAssetId: string,
): Promise<PurchasedMediaLink> {
  try {
    const r = await api.get<{ url?: unknown }>(
      `/v1/client/media/${encodeURIComponent(mediaAssetId)}/signed-url`,
    );
    const url = r.data?.url;
    if (typeof url === 'string' && url.startsWith('https://')) {
      return { ok: true, url };
    }
    return { ok: false, reason: 'unavailable' };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 409) return { ok: false, reason: 'not_ready' };
    if (typeof status === 'number') return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'network' };
  }
}

export async function openPurchasedMedia(mediaAssetId: string): Promise<void> {
  const link = await fetchPurchasedMediaLink(mediaAssetId);
  if (!link.ok) {
    const copy = PURCHASED_MEDIA_COPY[link.reason];
    Alert.alert(copy.title, copy.message);
    return;
  }
  try {
    await WebBrowser.openBrowserAsync(link.url);
  } catch {
    const copy = PURCHASED_MEDIA_COPY.viewer;
    Alert.alert(copy.title, copy.message);
  }
}
