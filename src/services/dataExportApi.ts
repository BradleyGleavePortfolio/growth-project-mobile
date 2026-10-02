import api from './api';

export interface DataExportRecord {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'READY' | 'EXPIRED' | 'FAILED';
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  file_size_bytes: number | null;
  /**
   * True only when the backend holds the finished file in its private
   * storage and can stream it now. A READY record with this false has no
   * file to give (an older export, or one whose file was removed), so the
   * UI offers a new export instead of a download.
   */
  download_available?: boolean;
  /**
   * Short-lived (5-minute) download token kept for older app builds. This
   * build asks for a fresh link at the moment of the tap instead
   * (createDownloadLink), so a link never goes stale on screen.
   */
  download_token?: string | null;
  /**
   * When a new export can be requested: while one is being built, or within
   * 24 hours of a downloadable one. Null when a request is allowed now.
   */
  next_request_at?: string | null;
}

export interface DataExportDownloadLink {
  /** Path under the API base URL, e.g. /v1/me/data-export/download?token=... */
  download_path: string;
  token: string;
  expires_at: string;
  file_name: string;
  file_size_bytes: number | null;
}

/** Stable backend error codes for the data export endpoints. */
export type DataExportErrorCode =
  | 'DATA_EXPORT_NOT_FOUND'
  | 'DATA_EXPORT_IN_PROGRESS'
  | 'EXPORT_ALREADY_IN_PROGRESS'
  | 'DATA_EXPORT_RATE_LIMITED'
  | 'DATA_EXPORT_NOT_READY'
  | 'DATA_EXPORT_EXPIRED'
  | 'DATA_EXPORT_FILE_MISSING'
  | 'DATA_EXPORT_STORAGE_UNAVAILABLE'
  | 'DATA_EXPORT_LINK_INVALID'
  | 'DATA_EXPORT_LINK_EXPIRED';

/** The machine `code` from an API error envelope, or null. */
export function dataExportErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return null;
  const data = (response as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

export const dataExportApi = {
  /**
   * POST /v1/me/data-export/request
   * Enqueue a new export. Returns immediately; poll /status for completion.
   * 409 DATA_EXPORT_IN_PROGRESS / DATA_EXPORT_RATE_LIMITED, 503
   * DATA_EXPORT_STORAGE_UNAVAILABLE.
   */
  async requestExport(): Promise<DataExportRecord> {
    const { data } = await api.post<DataExportRecord>(
      '/v1/me/data-export/request',
    );
    return data;
  },

  /**
   * GET /v1/me/data-export/status
   * Returns the most recent export request or null (404 → null).
   */
  async getStatus(): Promise<DataExportRecord | null> {
    try {
      const { data } = await api.get<DataExportRecord>(
        '/v1/me/data-export/status',
      );
      return data;
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: { status?: number } }).response?.status === 'number' &&
        (err as { response: { status: number } }).response.status === 404
      ) {
        return null;
      }
      throw err;
    }
  },

  /**
   * POST /v1/me/data-export/download-link
   * A fresh 5-minute link to the caller's latest export, minted for the
   * signed-in user only. 404 DATA_EXPORT_NOT_FOUND, 409
   * DATA_EXPORT_NOT_READY, 410 DATA_EXPORT_EXPIRED / DATA_EXPORT_FILE_MISSING.
   */
  async createDownloadLink(): Promise<DataExportDownloadLink> {
    const { data } = await api.post<DataExportDownloadLink>(
      '/v1/me/data-export/download-link',
    );
    return data;
  },
};

export default dataExportApi;
