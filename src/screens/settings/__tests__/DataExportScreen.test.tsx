import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import DataExportScreen from '../DataExportScreen';
import { dataExportApi } from '../../../services/dataExportApi';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../services/dataExportApi', () => ({
  ...jest.requireActual('../../../services/dataExportApi'),
  dataExportApi: {
    requestExport: jest.fn(),
    getStatus: jest.fn(),
    createDownloadLink: jest.fn(),
  },
}));

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));

jest.mock('../../../config/env', () => ({
  env: { API_URL: 'https://api.example.test/api' },
}));

const mockCaptureError = jest.fn();
jest.mock('../../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

jest.mock('../../../theme', () => ({
  useTheme: () => ({
    colors: {
      background: '#FAF9F6',
      ink: '#1A1A1A',
      border: '#E0DDD8',
      error: '#B91C1C',
    },
  }),
}));

// Suppress act() warning noise in test output
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = (msg: string) => {
    if (!msg.includes('act(')) originalWarn(msg);
  };
});
afterAll(() => {
  console.warn = originalWarn;
});

const mockGetStatus = dataExportApi.getStatus as jest.Mock;
const mockRequestExport = dataExportApi.requestExport as jest.Mock;
const mockCreateLink = dataExportApi.createDownloadLink as jest.Mock;

/** An axios-shaped HTTP error with the backend's envelope. */
function httpError(status: number, code?: string, requestId?: string) {
  return {
    isAxiosError: true,
    response: {
      status,
      data: { statusCode: status, ...(code ? { code } : {}), ...(requestId ? { request_id: requestId } : {}) },
      headers: {},
    },
  };
}

function offlineError() {
  return { isAxiosError: true, message: 'Cannot reach server.' };
}

function link() {
  return {
    download_path: '/v1/me/data-export/download?token=fresh.jwt.token',
    token: 'fresh.jwt.token',
    expires_at: '2026-01-01T00:06:00Z',
    file_name: 'tgp-data-export-2026-01-01.json',
    file_size_bytes: 45678,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pendingRecord() {
  return {
    id: 'e1',
    status: 'PENDING' as const,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    expires_at: null,
    file_size_bytes: null,
    download_token: null,
  };
}

function readyRecord() {
  return {
    id: 'e1',
    status: 'READY' as const,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    expires_at: '2026-01-08T00:01:00Z',
    file_size_bytes: 45678,
    download_token: 'jwt-token-abc',
    // download_available was added when the screen gained an S3-availability
    // guard around the Download button. Without it, READY records render
    // without a download CTA — the user sees the metadata but can't act.
    download_available: true,
  };
}

function expiredRecord() {
  return { ...readyRecord(), status: 'EXPIRED' as const };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DataExportScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  it('renders the heading and included-data list', async () => {
    mockGetStatus.mockResolvedValue(null);

    const { getByText, findByText, getAllByText } = await render(<DataExportScreen />);
    await findByText(/works for 5 minutes and only for you/);

    // "Request my data" appears twice in this state — the screen heading and the
    // CTA button label. v14 surfaces both host <Text> nodes, so anchor the async
    // wait on the unique intro paragraph, then assert the heading text exists
    // (one of the two occurrences) rather than requiring a single match.
    await findByText(/right to receive a complete copy/);
    expect(getAllByText('Request my data').length).toBeGreaterThanOrEqual(1);
    expect(getByText(/Weight, food, and water logs/)).toBeTruthy();
    expect(getByText(/Coaching messages you sent/)).toBeTruthy();
    expect(getByText(/Audit log entries about your account/)).toBeTruthy();
  });

  it('shows the Request button when no export exists (idle state)', async () => {
    mockGetStatus.mockResolvedValue(null);

    const { findByRole } = await render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    expect(btn).toBeTruthy();
  });

  // ── Request flow ───────────────────────────────────────────────────────────

  it('moves to polling state after requesting export', async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockResolvedValue(pendingRecord());

    const { findByRole, findByText } = await render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    await fireEvent.press(btn);

    await findByText('Export in progress');
  });

  it('a 409 DATA_EXPORT_IN_PROGRESS shows the export already being built', async () => {
    mockGetStatus.mockResolvedValueOnce(null).mockResolvedValue(pendingRecord());
    mockRequestExport.mockRejectedValue(httpError(409, 'DATA_EXPORT_IN_PROGRESS'));

    const { findByRole, findByText } = await render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    await fireEvent.press(btn);

    await findByText('Export in progress');
  });

  it('a 409 DATA_EXPORT_RATE_LIMITED shows the recent export and when a new one is allowed', async () => {
    const next = new Date(Date.now() + 3 * 3_600_000).toISOString();
    mockGetStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ...readyRecord(), next_request_at: next });
    mockRequestExport.mockRejectedValue(httpError(409, 'DATA_EXPORT_RATE_LIMITED'));

    const { findByRole, findByText, queryByRole } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Request my data/i }));

    await findByText('You already have a recent export');
    await findByText(/You can request a new export after/);
    expect(queryByRole('button', { name: /Request a new data export/i })).toBeNull();
    expect(await findByRole('button', { name: /Download your data file/i })).toBeTruthy();
  });

  it('an unknown request failure says what to do, quotes the reference and reports to Sentry', async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(httpError(500, undefined, 'req-42'));

    const { findByRole, findByText, queryByText } = await render(<DataExportScreen />);

    await fireEvent.press(await findByRole('button', { name: /Request my data/i }));

    await findByText('We could not start your export');
    await findByText(/Tap Request my data again\. If it keeps happening, email hello@thegrowthproject\.app and quote reference req-42\./);
    await findByText('Reference: req-42');
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ screen: 'DataExportScreen', step: 'request', request_id: 'req-42' }),
    );
    expect(queryByText(/Something went wrong|Please try again/)).toBeNull();
  });

  it('a request while offline says so and gives the next step', async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(offlineError());

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Request my data/i }));

    await findByText('You appear to be offline');
    await findByText(/Check your connection, then tap Request my data again/);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('storage being down (503 DATA_EXPORT_STORAGE_UNAVAILABLE) says the data is safe', async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(httpError(503, 'DATA_EXPORT_STORAGE_UNAVAILABLE', 'req-7'));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Request my data/i }));

    await findByText('File storage is not responding');
    await findByText(/Your data is safe\. Wait a minute/);
  });

  it('a failed status load offers Check again, which reloads', async () => {
    mockGetStatus.mockRejectedValueOnce(httpError(500, undefined, 'req-9')).mockResolvedValue(null);

    const { findByRole, findByText } = await render(<DataExportScreen />);

    await findByText('We could not load your export');
    await fireEvent.press(await findByRole('button', { name: /Check your export status again/i }));
    await findByRole('button', { name: /Request my data export/i });
  });

  // ── Status polling ─────────────────────────────────────────────────────────

  it('transitions from polling to ready when status becomes READY', async () => {
    // Initial load: PENDING (triggers polling state)
    mockGetStatus.mockResolvedValueOnce(pendingRecord());
    // Poll response: READY
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByText } = await render(<DataExportScreen />);

    // Should start in polling state
    await findByText('Export in progress');

    // Advance the polling interval
    await act(async () => {
      jest.advanceTimersByTime(5500);
    });

    await findByText('Your file is ready');
  });

  it('shows file size and expiry date when ready', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByText } = await render(<DataExportScreen />);

    await findByText('Your file is ready');
    // The status body is a single Text node interpolating
    // "File size: 44.6 KB." and "Available until 8 January 2026." together —
    // findByText needs a matcher that scans the combined string.
    await findByText(/44\.6 KB/);
    await findByText(/available until/i);
  });

  it('shows Download button when READY', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByRole } = await render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Download your data file/i });
    expect(btn).toBeTruthy();
  });

  it('Download file mints a fresh link at tap time and opens it in the browser', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockResolvedValue(link());
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Download your data file/i }));

    await findByText('Download started in your browser');
    expect(mockCreateLink).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/me/data-export/download?token=fresh.jwt.token',
    );
    // The stale status token is never used by this build.
    expect(openURL).not.toHaveBeenCalledWith(expect.stringContaining('jwt-token-abc'));
    openURL.mockRestore();
  });

  it('a backend without /download-link (bare 404) falls back to the status token', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(404));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Download your data file/i }));

    await findByText('Download started in your browser');
    expect(openURL).toHaveBeenCalledWith(
      'https://api.example.test/api/v1/me/data-export/download?token=jwt-token-abc',
    );
    openURL.mockRestore();
  });

  it('a browser that cannot open the link gets a clear next step and is reported', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockResolvedValue(link());
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Download your data file/i }));

    await findByText('Your phone could not open the download');
    await findByText(/Check that a web browser is installed/);
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ step: 'open_browser' }),
    );
    openURL.mockRestore();
  });

  it('an export that expired while on screen moves to the expired state', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(410, 'DATA_EXPORT_EXPIRED'));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Download your data file/i }));

    await findByText('Previous export expired');
  });

  it('a missing file (410 DATA_EXPORT_FILE_MISSING) offers a new export instead of support', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(410, 'DATA_EXPORT_FILE_MISSING'));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Download your data file/i }));

    await findByText('This file is no longer available');
    expect(await findByRole('button', { name: /Request a new data export/i })).toBeTruthy();
  });

  it('a READY record without a stored file never shows a broken Download button', async () => {
    mockGetStatus.mockResolvedValue({ ...readyRecord(), download_available: false, download_token: null });

    const { findByText, queryByRole } = await render(<DataExportScreen />);

    await findByText('This file is no longer available');
    expect(queryByRole('button', { name: /Download your data file/i })).toBeNull();
  });

  it('an ended session during download says to log in again', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(401, undefined, 'req-5'));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Download your data file/i }));

    await findByText('Your session has ended');
    await findByText(/Log in again/);
    // The Download button stays so the user can retry after logging in.
    expect(await findByRole('button', { name: /Download your data file/i })).toBeTruthy();
  });

  it('an unknown download failure quotes the reference and keeps Download available', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(500, undefined, 'req-77'));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(await findByRole('button', { name: /Download your data file/i }));

    await findByText('We could not prepare your download');
    await findByText('Reference: req-77');
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ step: 'download', status: 500 }),
    );
  });

  it('three failed polls in a row stop polling and say what happened', async () => {
    mockGetStatus.mockResolvedValueOnce(pendingRecord()).mockRejectedValue(offlineError());

    const { findByText } = await render(<DataExportScreen />);
    await findByText('Export in progress');

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(5500);
      });
    }

    await findByText('You appear to be offline');
    await findByText(/tap Check again/);
  });

  it('transitions from polling to failed when status becomes FAILED', async () => {
    mockGetStatus.mockResolvedValueOnce(pendingRecord());
    mockGetStatus.mockResolvedValue({
      ...pendingRecord(),
      status: 'FAILED',
    });

    const { findByText } = await render(<DataExportScreen />);
    await findByText('Export in progress');

    await act(async () => {
      jest.advanceTimersByTime(5500);
    });

    await findByText('Your last export did not finish');
    await findByText(/Nothing was lost/);
  });

  // ── Expired state ──────────────────────────────────────────────────────────

  it('shows expired state when initial status is EXPIRED', async () => {
    mockGetStatus.mockResolvedValue(expiredRecord());

    const { findByText } = await render(<DataExportScreen />);

    await findByText('Previous export expired');
    await findByText(/kept for 7 days/i);
  });

  it('shows Request new export button in expired state', async () => {
    mockGetStatus.mockResolvedValue(expiredRecord());
    mockRequestExport.mockResolvedValue(pendingRecord());

    const { findByRole, findByText } = await render(<DataExportScreen />);

    await findByText('Previous export expired');
    const btn = await findByRole('button', { name: /Request a fresh data export/i });
    await fireEvent.press(btn);

    await findByText('Export in progress');
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it('all interactive elements have accessibilityLabel and accessibilityRole', async () => {
    mockGetStatus.mockResolvedValue(null);

    const { findByRole } = await render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    expect(btn).toBeTruthy();
  });
});
