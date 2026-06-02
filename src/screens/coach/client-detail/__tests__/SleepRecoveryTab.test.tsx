/**
 * SleepRecoveryTab (coach) — the IDOR-safe 403 fallback is the headline test
 * (50-Failures #5). Also verifies: coach-only anomaly band + cohort comparison
 * render with data, and a non-403 error surfaces a retry (never swallowed, #36).
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import type { WearableSamplesResponse } from '../../../../api/wearablesSamplesApi';
import { WearableSamplesError } from '../../../../api/wearablesSamplesApi';
import { makeStyles } from '../styles';
import { testColors } from '../../../client/wearables/recoveryTestColors';

const mockUseWearableSamples = jest.fn();
jest.mock('../../../../hooks/useWearableSamples', () => ({
  useWearableSamples: (opts: unknown) => mockUseWearableSamples(opts),
}));

import { SleepRecoveryTab } from '../SleepRecoveryTab';

const styles = makeStyles(testColors);

function resp(series: WearableSamplesResponse['series']): WearableSamplesResponse {
  return {
    version: 1,
    user_id: 'client-1',
    bucket: 'SLEEP_RECOVERY',
    window: { from: 'a', to: 'b' },
    series,
    freshness: { providers: [] },
  };
}
function s(value: number, day = 1) {
  const d = String(day).padStart(2, '0');
  return { start_at: `2026-05-${d}T22:00:00Z`, end_at: `2026-05-${d}T22:00:01Z`, value, provider: 'OURA' };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
});
afterEach(() => jest.restoreAllMocks());

describe('SleepRecoveryTab — IDOR (#5)', () => {
  it('renders RecoveryUnavailable on a 403, never throwing', () => {
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: new WearableSamplesError('forbidden', 403, 'WEARABLE_SAMPLES_FORBIDDEN'),
    });
    const { getByTestId, getByText } = render(
      <SleepRecoveryTab clientId="other-coach-client" colors={testColors} styles={styles} />,
    );
    expect(getByTestId('recovery-unavailable')).toBeTruthy();
    expect(getByText(/don't have access/i)).toBeTruthy();
  });

  it('also handles a plain { status: 403 } transport error gracefully', () => {
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: { status: 403, message: 'forbidden' } as unknown as Error,
    });
    const { getByTestId } = render(
      <SleepRecoveryTab clientId="c1" colors={testColors} styles={styles} />,
    );
    expect(getByTestId('recovery-unavailable')).toBeTruthy();
  });
});

describe('SleepRecoveryTab — other errors (#36)', () => {
  it('surfaces a retry on a non-403 failure', () => {
    const refetch = jest.fn();
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isError: true,
      isLoading: false,
      isRefetching: false,
      refetch,
      error: new WearableSamplesError('degraded', 503, 'WEARABLE_SAMPLES_DEGRADED'),
    });
    const { getByTestId } = render(<SleepRecoveryTab clientId="c1" colors={testColors} styles={styles} />);
    fireEvent.press(getByTestId('coach-recovery-retry'));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('SleepRecoveryTab — coach-only overlays', () => {
  it('renders the anomaly band and cohort comparison when there is HRV data', () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        {
          metric: 'HRV_MS',
          unit: 'ms',
          provider_used: 'OURA',
          sample_count: 5,
          samples: [s(40, 1), s(45, 2), s(50, 3), s(55, 4), s(30, 5)],
          buckets: [
            { bucket_start: '2026-05-01T00:00:00Z', bucket_end: '2026-05-02T00:00:00Z', agg: 40, count: 1 },
            { bucket_start: '2026-05-02T00:00:00Z', bucket_end: '2026-05-03T00:00:00Z', agg: 45, count: 1 },
            { bucket_start: '2026-05-03T00:00:00Z', bucket_end: '2026-05-04T00:00:00Z', agg: 30, count: 1 },
          ],
        },
        { metric: 'RECOVERY_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [s(64)] },
      ]),
      isError: false,
      isLoading: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = render(<SleepRecoveryTab clientId="c1" colors={testColors} styles={styles} />);
    expect(getByTestId('coach-anomaly-band')).toBeTruthy();
    expect(getByTestId('coach-cohort-comparison')).toBeTruthy();
    expect(getByTestId('coach-recovery-tab')).toBeTruthy();
  });
});
