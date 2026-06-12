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
import { render, waitFor } from '@testing-library/react-native';
import { colors } from '../../../theme/tokens';

// ── Sentinel for the ED.4 card — capture the props it is wired with. ────────
let chartProps: { data?: Array<{ x: number; y: number }>; liftName?: string } =
  {};
jest.mock('../progress/ProgressChartCard', () => {
  const mockReact = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: { data: Array<{ x: number; y: number }>; liftName: string }) => {
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

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: require('../../../theme/tokens').colors }),
}));

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

  // Guard against regression: tokens import is real so makeStyles(colors) works.
  it('uses real theme tokens (sanity)', () => {
    expect(colors).toBeDefined();
  });
});
