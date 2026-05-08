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

interface RequestExportResponse {
  id: string;
  status: 'PENDING';
  created_at: string;
  message: string;
}

export const dataExportApi = {
  /**
   * POST /v1/me/data-export/request
   * Enqueue a new export. Returns immediately; poll /status for completion.
   * Throws with err.response.status on HTTP errors (e.g. 409 for rate limit).
   */
  async requestExport(): Promise<RequestExportResponse> {
    const { data } = await api.post<RequestExportResponse>(
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
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },
};

export default dataExportApi;
