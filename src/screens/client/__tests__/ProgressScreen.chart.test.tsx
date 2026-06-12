/**
 * ProgressScreen — ED.4 wiring smoke test (P1-1).
 *
 * Pins the fix: the weight trend is rendered through ProgressChartCard (the
 * ED.4 showpiece), NOT the legacy TgpLineChart. ProgressChartCard is mocked to
 * a sentinel so this stays a wiring assertion (does the screen mount the card
 * with the chart series?) rather than a re-test of the card's internals.
 *
 * weightApi.getHistory returns two rows so the chart branch (needs ≥2 points)
 * renders; everything else the screen reaches on mount is mocked to inert.
 */
import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';
import { colors } from '../../../theme/tokens';

// ── Sentinel for the ED.4 card — capture the props it is wired with. ────────
let chartProps: {
  data?: Array<{ x: number; y: number }>;
  liftName?: string;
  enablePRDetection?: boolean;
} = {};
jest.mock('../progress/ProgressChartCard', () => {
  const mockReact = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: {
      data: Array<{ x: number; y: number }>;
      liftName: string;
      enablePRDetection?: boolean;
    }) => {
      chartProps = props;
      return mockReact.createElement(View, { testID: 'mock-progress-chart-card' });
    },
  };
});

// ── Data + environment mocks (inert; just enough to mount). ─────────────────
const mockGetHistory = jest.fn(async () => ({
  data: [
    { id: '1', date: '2026-06-01', weight_lbs: 185 },
    { id: '2', date: '2026-06-08', weight_lbs: 183 },
  ],
}));
jest.mock('../../../services/api', () => ({
  weightApi: {
    getHistory: (...args: unknown[]) => mockGetHistory(...(args as [])),
    log: jest.fn(async () => ({})),
  },
  logApi: { getDaily: jest.fn(async () => ({ data: {} })) },
}));

jest.mock('../../../hooks/useMacroTargets', () => ({
  useMacroTargets: () => ({
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 60,
    height: 70,
    tdee: 2000,
  }),
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'user-1' }),
}));

jest.mock('../../../theme/ThemeProvider', () => {
  const tokens = require('../../../theme/tokens');
  // The error branch (audit R2 P2) mounts CoachErrorState, which reads
  // `semanticColors` from the same useTheme (re-exported from ThemeProvider),
  // so the mock must surface both the legacy `colors` and `semanticColors`.
  return {
    useTheme: () => ({
      colorScheme: 'light',
      colors: tokens.colors,
      semanticColors: tokens.lightTokens,
    }),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));

import ProgressScreen from '../ProgressScreen';

beforeEach(() => {
  chartProps = {};
});

describe('ProgressScreen — ED.4 wiring (P1-1)', () => {
  it('renders the weight trend via ProgressChartCard with the chart series', async () => {
    const { getByTestId } = render(<ProgressScreen />);

    // The weight history load fires on mount.
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalled());
    // The ED.4 card is mounted (replacing the legacy TgpLineChart).
    await waitFor(() => expect(getByTestId('mock-progress-chart-card')).toBeTruthy());

    // It receives the {x, y} weight series and a liftName for the Roman line.
    await waitFor(() => expect(chartProps.data?.length).toBe(2));
    expect(chartProps.data?.[0]).toEqual(
      expect.objectContaining({ y: 185 }),
    );
    expect(typeof chartProps.liftName).toBe('string');
    expect((chartProps.liftName ?? '').length).toBeGreaterThan(0);
  });

  it('wires the bodyweight chart with PR detection OFF (audit R3 P2)', async () => {
    // The bodyweight trend is not a performance record — a rising weight is not
    // a "personal best". The screen must pass enablePRDetection={false} so no
    // false PR commentary renders for weight-loss clients.
    render(<ProgressScreen />);
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalled());
    await waitFor(() => expect(chartProps.data?.length).toBe(2));
    expect(chartProps.enablePRDetection).toBe(false);
  });

  // Guard against regression: tokens import is real so makeStyles(colors) works.
  it('uses real theme tokens (sanity)', () => {
    expect(colors).toBeDefined();
  });
});

describe('ProgressScreen — ED.4 chart load error (audit R2 P2)', () => {
  it('renders an honest retry state (not the empty copy) when the history load fails', async () => {
    // The history fetch rejects: the screen must surface an honest Roman-tone
    // error+retry state, NOT the benign "log your weight" empty copy.
    mockGetHistory.mockRejectedValueOnce(new Error('network down'));
    const { getByTestId, queryByText } = render(<ProgressScreen />);

    await waitFor(() => expect(mockGetHistory).toHaveBeenCalled());
    // The error surface (CoachErrorState) is mounted with its retry action...
    await waitFor(() =>
      expect(getByTestId('progress-weight-chart-error')).toBeTruthy(),
    );
    expect(getByTestId('progress-weight-chart-error-retry')).toBeTruthy();
    // Roman's neutral face is co-mounted on the error surface (FACE+VOICE).
    expect(getByTestId('progress-weight-chart-error-avatar')).toBeTruthy();
    // ...and the false-empty copy is absent.
    expect(queryByText('Log your weight to see your chart')).toBeNull();
    expect(queryByText('Need at least 2 entries for a chart')).toBeNull();
  });

  it('clears the error and renders the chart when a retry succeeds', async () => {
    // First load fails → error state; retry resolves with a 2-point series →
    // the chart renders and the error state is gone.
    mockGetHistory.mockRejectedValueOnce(new Error('network down'));
    const { getByTestId, queryByTestId } = render(<ProgressScreen />);

    await waitFor(() =>
      expect(getByTestId('progress-weight-chart-error')).toBeTruthy(),
    );

    // The default mock implementation now resolves with two rows again.
    await act(async () => {
      fireEvent.press(getByTestId('progress-weight-chart-error-retry'));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(getByTestId('mock-progress-chart-card')).toBeTruthy(),
    );
    expect(queryByTestId('progress-weight-chart-error')).toBeNull();
  });

  it('disables the retry button while a direct retry is in flight (audit R3 P3)', async () => {
    // The chart-error retry calls loadData directly. Until R4 the button used
    // `refreshing` (pull-to-refresh only), so it stayed enabled and could be
    // spammed. A dedicated retry-in-flight state must disable it until settle.
    mockGetHistory.mockRejectedValueOnce(new Error('network down'));
    // Hold the RETRY call open so we can observe the disabled state mid-flight.
    let resolveRetry: (v: { data: unknown[] }) => void = () => {};
    mockGetHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve as (v: { data: unknown[] }) => void;
        }),
    );

    const { getByTestId } = render(<ProgressScreen />);
    await waitFor(() =>
      expect(getByTestId('progress-weight-chart-error')).toBeTruthy(),
    );

    const retryBtn = getByTestId('progress-weight-chart-error-retry');
    // Before retry: enabled.
    expect(retryBtn.props.accessibilityState?.disabled).toBe(false);

    // Tap retry — the call is held open, so the button must now be disabled.
    act(() => {
      fireEvent.press(retryBtn);
    });
    await waitFor(() =>
      expect(
        getByTestId('progress-weight-chart-error-retry').props.accessibilityState
          ?.disabled,
      ).toBe(true),
    );

    // Settle the retry with a 2-point series — the chart renders and the error
    // surface (with its now-cleared retry latch) is gone.
    await act(async () => {
      resolveRetry({ data: [
        { id: '1', date: '2026-06-01', weight_lbs: 185 },
        { id: '2', date: '2026-06-08', weight_lbs: 183 },
      ] });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(getByTestId('mock-progress-chart-card')).toBeTruthy(),
    );
  });
});
