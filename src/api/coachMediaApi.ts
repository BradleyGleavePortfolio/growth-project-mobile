// Coach media library (PDF + video) for package contents (B-DROPS-125).
// Backend coach-media.controller.ts, live in production: GET /v1/coach/media,
// POST pdf/upload-url + :id/pdf/confirm (Supabase), POST video/upload-url (Mux;
// its webhook flips the row to 'ready'). Bytes go straight to the signed URL.
// `byte_size` is never sent: it is a BigInt column the API cannot serialise
// when non-null, so leaving it null keeps list/confirm responses readable.
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import api from '../services/api';

export type CoachMediaKind = 'pdf' | 'video';
export interface CoachMediaAsset {
  id: string;
  kind: CoachMediaKind;
  title: string;
  status: string; // uploading | processing | ready | errored
}
export interface PickedMediaFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

export const PDF_MAX_BYTES = 50 * 1024 * 1024;
const TRANSFER_FAILED = 'The upload did not finish. Check the connection and try again.';

export class MediaUploadError extends Error {}

export function mediaTitleFromFile(name: string, fallback: string): string {
  return (name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || fallback).slice(0, 200);
}

export const coachMediaApi = {
  list: (kind: CoachMediaKind) =>
    api.get<{ media: CoachMediaAsset[] }>('/v1/coach/media', { params: { kind } }),

  /** Create the row, send the file, confirm (PDF). Resolves with the asset id. */
  async upload(kind: CoachMediaKind, file: PickedMediaFile, title: string): Promise<string> {
    if (kind === 'pdf' && (file.size ?? 0) > PDF_MAX_BYTES) {
      throw new MediaUploadError('PDFs can be up to 50 MB.');
    }
    const ticket = await api.post<{ media_asset_id: string; upload_url: string }>(
      `/v1/coach/media/${kind}/upload-url`,
      kind === 'pdf' ? { title, content_type: 'application/pdf' } : { title },
    );
    const { media_asset_id: id, upload_url: url } = ticket.data;
    const status = await uploadAsync(url, file.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'Content-Type': kind === 'pdf' ? 'application/pdf' : file.mimeType || 'video/mp4',
      },
    }).then(
      (res) => res.status,
      () => 0,
    );
    if (status < 200 || status >= 300) throw new MediaUploadError(TRANSFER_FAILED);
    if (kind === 'pdf') {
      await api.post(`/v1/coach/media/${encodeURIComponent(id)}/pdf/confirm`, {});
    }
    return id;
  },
};

/** Specific, coach-facing copy for an upload failure. */
export function describeMediaUploadFailure(err: unknown): string {
  if (err instanceof MediaUploadError) return err.message;
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 503) return 'Uploads are unavailable right now. Try again in a few minutes.';
  if (status === 400) {
    return 'That file could not be accepted. Pick a PDF up to 50 MB or a standard video file.';
  }
  if (status === 402 || status === 403) {
    return 'Uploading files needs an active coach subscription.';
  }
  return TRANSFER_FAILED;
}
