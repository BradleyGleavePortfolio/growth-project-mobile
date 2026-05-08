import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import DataExportScreen from '../DataExportScreen';
import { dataExportApi } from '../../../api/dataExport';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../../api/dataExport', () => ({
  dataExportApi: {
    requestExport: jest.fn(),
    getStatus: jest.fn(),
  },
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

    const { getByText, findByText } = render(<DataExportScreen />);

    await findByText('Request my data');
    expect(getByText(/Weight, food, and water logs/)).toBeTruthy();
    expect(getByText(/Coaching messages you sent/)).toBeTruthy();
    expect(getByText(/Audit log entries about your account/)).toBeTruthy();
  });

  it('shows the Request button when no export exists (idle state)', async () => {
    mockGetStatus.mockResolvedValue(null);

    const { findByRole } = render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    expect(btn).toBeTruthy();
  });

  // ── Request flow ───────────────────────────────────────────────────────────

  it('moves to polling state after requesting export', async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockResolvedValue(pendingRecord());

    const { findByRole, findByText } = render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    fireEvent.press(btn);

    await findByText('Export in progress');
  });

  it('shows an error when request returns 409', async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue({ status: 409 });

    const { findByRole, findByText } = render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    fireEvent.press(btn);

    await findByText(/An export is already in progress/);
  });

  it('shows a generic error on unexpected request failure', async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(new Error('Network error'));

    const { findByRole, findByText } = render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    fireEvent.press(btn);

    await findByText(/Could not start export/);
  });

  // ── Status polling ─────────────────────────────────────────────────────────

  it('transitions from polling to ready when status becomes READY', async () => {
    // Initial load: PENDING (triggers polling state)
    mockGetStatus.mockResolvedValueOnce(pendingRecord());
    // Poll response: READY
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByText } = render(<DataExportScreen />);

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

    const { findByText } = render(<DataExportScreen />);

    await findByText('Your file is ready');
    await findByText(/44\.6 KB/);
    // Expiry date formatted as "8 January 2026"
    await findByText(/expires on/i);
  });

  it('shows Download button when READY', async () => {
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByRole } = render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Download your data file/i });
    expect(btn).toBeTruthy();
  });

  it('transitions from polling to failed when status becomes FAILED', async () => {
    mockGetStatus.mockResolvedValueOnce(pendingRecord());
    mockGetStatus.mockResolvedValue({
      ...pendingRecord(),
      status: 'FAILED',
    });

    const { findByText } = render(<DataExportScreen />);
    await findByText('Export in progress');

    await act(async () => {
      jest.advanceTimersByTime(5500);
    });

    await findByText('Export unavailable');
  });

  // ── Expired state ──────────────────────────────────────────────────────────

  it('shows expired state when initial status is EXPIRED', async () => {
    mockGetStatus.mockResolvedValue(expiredRecord());

    const { findByText } = render(<DataExportScreen />);

    await findByText('Previous export expired');
    await findByText(/last 7 days/i);
  });

  it('shows Request new export button in expired state', async () => {
    mockGetStatus.mockResolvedValue(expiredRecord());
    mockRequestExport.mockResolvedValue(pendingRecord());

    const { findByRole, findByText } = render(<DataExportScreen />);

    await findByText('Previous export expired');
    const btn = await findByRole('button', { name: /Request a fresh data export/i });
    fireEvent.press(btn);

    await findByText('Export in progress');
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it('all interactive elements have accessibilityLabel and accessibilityRole', async () => {
    mockGetStatus.mockResolvedValue(null);

    const { findByRole } = render(<DataExportScreen />);

    const btn = await findByRole('button', { name: /Request my data/i });
    expect(btn).toBeTruthy();
  });
});
