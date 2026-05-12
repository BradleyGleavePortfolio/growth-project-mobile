import api from './api';

export interface DataExportRecord {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'READY' | 'EXPIRED' | 'FAILED';
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  file_size_bytes: number | null;
  download_token: string | null;
}

export const dataExportApi = {
  /**
   * POST /v1/me/data-export/request
   * Enqueue a new export. Returns immediately; poll /status for completion.
   * Throws with err.response.status on HTTP errors (e.g. 409 for rate limit).
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
};

export default dataExportApi;
