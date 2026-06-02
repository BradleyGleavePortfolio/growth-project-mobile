/**
 * SleepRecoveryScreen — integration-ish tests with the samples hook + theme
 * mocked. Covers: empty state (anti-spinner), error state (typed + retry),
 * the reassurance-first deficit banner, and #8 bucket-param validation.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import type { WearableSamplesResponse } from '../../../../api/wearablesSamplesApi';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockUseWearableSamples = jest.fn();
jest.mock('../../../../hooks/useWearableSamples', () => ({
  useWearableSamples: (opts: unknown) => mockUseWearableSamples(opts),
}));

jest.mock('../../../../theme/ThemeProvider', () => {
  const { testColors } = jest.requireActual('../recoveryTestColors');
  return { useTheme: () => ({ colors: testColors }) };
});

import SleepRecoveryScreen from '../SleepRecoveryScreen';

function resp(series: WearableSamplesResponse['series']): WearableSamplesResponse {
  return {
    version: 1,
    user_id: 'u1',
    bucket: 'SLEEP_RECOVERY',
    window: { from: 'a', to: 'b' },
    series,
    freshness: { providers: [] },
  };
}

function s(value: number) {
  return { start_at: '2026-05-01T22:00:00Z', end_at: '2026-05-01T22:00:01Z', value, provider: 'OURA' };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
});
afterEach(() => jest.restoreAllMocks());

describe('SleepRecoveryScreen', () => {
  it('renders the empty state (NOT a spinner) when there is no data', () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = render(<SleepRecoveryScreen />);
    expect(getByTestId('sleep-recovery-empty')).toBeTruthy();
  });

  it('CTA on the empty state navigates to Connections', () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = render(<SleepRecoveryScreen />);
    fireEvent.press(getByTestId('sleep-recovery-empty-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  it('renders a typed error state with retry when the query fails and no cache', () => {
    const refetch = jest.fn();
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isRefetching: false,
      refetch,
      error: new Error('network'),
    });
    const { getByTestId } = render(<SleepRecoveryScreen />);
    fireEvent.press(getByTestId('sleep-recovery-error-retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows the reassurance-first deficit banner when sleep is under need', () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        { metric: 'RECOVERY_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [s(70)] },
        { metric: 'SLEEP_DURATION_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [s(420)] },
      ]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = render(<SleepRecoveryScreen />);
    const reassurance = getByTestId('phantom-calm-reassurance').props.children as string;
    const deficit = getByTestId('phantom-calm-deficit').props.children as string;
    expect(reassurance).toMatch(/close/i);
    expect(deficit).toMatch(/under your sleep need/);
  });

  it('renders the recovery hero with the score', () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        { metric: 'RECOVERY_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [s(81)] },
      ]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = render(<SleepRecoveryScreen />);
    expect(getByTestId('recovery-state-label').props.children).toBe('Recovered');
  });

  it('tolerates a malformed bucket param (#8 — falls back, no crash)', () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        { metric: 'RECOVERY_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1, samples: [s(50)] },
      ]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = render(<SleepRecoveryScreen bucketParam={'__evil__' as unknown as string} />);
    expect(getByTestId('recovery-ring-hero')).toBeTruthy();
    // The hook is always asked for the SLEEP_RECOVERY bucket regardless of param.
    expect(mockUseWearableSamples).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'SLEEP_RECOVERY' }),
    );
  });
});
