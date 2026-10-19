/**
 * SleepRecoveryScreen — integration-ish tests with the samples hook + theme
 * mocked. Covers: empty state (anti-spinner), error state (typed + retry),
 * the factual sleep-duration banner, and #8 bucket-param validation.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import type {
  WearableSamplesResponse,
  SampleDatum,
} from '../../../../api/wearablesSamplesApi';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockUseWearableSamples = jest.fn();
jest.mock('../../../../hooks/useWearableSamples', () => ({
  useWearableSamples: (opts: unknown) => mockUseWearableSamples(opts),
}));

// The screen reads the user's connections to drive the FreshnessChip. Mock the
// hook so the overview path renders without a QueryClientProvider (the chip's
// pure variant takes the injected list directly).
const mockUseWearableConnections = jest.fn();
jest.mock('../../../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => mockUseWearableConnections(),
}));

jest.mock('../../../../theme/ThemeProvider', () => {
  const { testColors } = jest.requireActual('../recoveryTestColors');
  return { useTheme: () => ({ colors: testColors }) };
});

import SleepRecoveryScreen from '../SleepRecoveryScreen';
import { makeAccessibilitySubscription } from '../testSupport/accessibilityMocks';

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

function s(
  value: number,
  provider: SampleDatum['provider'] = 'OURA',
): SampleDatum {
  return { start_at: '2026-05-01T22:00:00Z', end_at: '2026-05-01T22:00:01Z', value, provider };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWearableConnections.mockReturnValue({ data: [] });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue(makeAccessibilitySubscription());
});
afterEach(() => jest.restoreAllMocks());

describe('SleepRecoveryScreen', () => {
  it.each([
    [180, '3h asleep'],
    [420, '7h asleep'],
    [0, 'Sleep stages appear once your tracker syncs a night'],
  ])('shows a factual sleep headline for %i minutes', async (minutes, expected) => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        { metric: 'SLEEP_LIGHT_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [s(minutes)] },
        { metric: 'SLEEP_AWAKE_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [s(30)] },
      ]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = await render(<SleepRecoveryScreen />);
    const headline = getByTestId('sleep-stages-headline').props.children as string;
    expect(headline).toBe(expected);
    expect(headline).not.toMatch(/\b(solid|restorative|good|great|poor|short)\b/i);
    expect(mockUseWearableSamples).toHaveBeenCalledWith(
      expect.not.objectContaining({ clientId: expect.anything() }),
    );
  });

  it('renders the empty state (NOT a spinner) when there is no data', async () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = await render(<SleepRecoveryScreen />);
    expect(getByTestId('sleep-recovery-empty')).toBeTruthy();
  });

  it('CTA on the empty state navigates to Connections', async () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = await render(<SleepRecoveryScreen />);
    await fireEvent.press(getByTestId('sleep-recovery-empty-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  it('renders a typed error state with retry when the query fails and no cache', async () => {
    // refetch returns a Promise (React Query contract) so the screen's
    // floated-with-logged-rejection retry path can chain `.catch`.
    const refetch = jest.fn().mockResolvedValue(undefined);
    mockUseWearableSamples.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isRefetching: false,
      refetch,
      error: new Error('network'),
    });
    const { getByTestId } = await render(<SleepRecoveryScreen />);
    await fireEvent.press(getByTestId('sleep-recovery-error-retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it.each([
    { minutes: 180, headline: '3h asleep', comparison: '5h below the 8h sleep reference' },
    { minutes: 420, headline: '7h asleep', comparison: '1h below the 8h sleep reference' },
    { minutes: 465, headline: '7h 45m asleep', comparison: '15 min below the 8h sleep reference' },
  ])('reports $minutes minutes without a closeness judgment or score', async ({ minutes, headline, comparison }) => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        { metric: 'SLEEP_DURATION_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [s(minutes)] },
      ]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId, getByLabelText } = await render(<SleepRecoveryScreen />);
    const reassurance = getByTestId('phantom-calm-reassurance').props.children as string;
    const deficit = getByTestId('phantom-calm-deficit').props.children as string;
    expect(reassurance).toBe(headline);
    expect(deficit).toBe(comparison);
    expect(`${reassurance} ${deficit}`).not.toMatch(/\b(close|good|poor|ready|recovered|your sleep need)\b/i);
    expect(getByLabelText(`${headline} ${comparison}`)).toBeTruthy();
    expect(getByTestId('recovery-state-label').props.children).toBe('Recovery');
  });

  it.each([466, 480, 540])('keeps the duration banner hidden for %i minutes', async (minutes) => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        { metric: 'SLEEP_DURATION_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1, samples: [s(minutes)] },
      ]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { queryByTestId } = await render(<SleepRecoveryScreen />);
    expect(queryByTestId('phantom-calm-banner')).toBeNull();
  });

  it('uses the shared factual HRV and bedtime copy without a score', async () => {
    mockUseWearableSamples.mockReturnValue({
      data: resp([
        { metric: 'HRV_MS', unit: 'ms', provider_used: 'OURA', sample_count: 3, samples: [s(60), s(62), s(40)] },
        { metric: 'SLEEP_ONSET_ISO', unit: 'min', provider_used: 'OURA', sample_count: 3, samples: [s(1320), s(1350), s(1335)] },
      ]),
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
      error: null,
    });
    const { getByTestId } = await render(<SleepRecoveryScreen />);
    expect(getByTestId('hrv-copy').props.children).toBe('Latest HRV reading: 40 ms');
    expect(getByTestId('consistency-copy').props.children).toBe('Bedtimes span 30 min');
    expect(mockUseWearableSamples).toHaveBeenCalledWith(
      expect.not.objectContaining({ clientId: expect.anything() }),
    );
  });

  it('renders the recovery hero with the score', async () => {
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
    const { getByTestId } = await render(<SleepRecoveryScreen />);
    expect(getByTestId('recovery-state-label').props.children).toBe('Recovered');
  });

  it('tolerates a malformed bucket param (#8 — falls back, no crash)', async () => {
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
    const { getByTestId } = await render(<SleepRecoveryScreen bucketParam="__evil__" />);
    expect(getByTestId('recovery-ring-hero')).toBeTruthy();
    // The hook is always asked for the SLEEP_RECOVERY bucket regardless of param.
    expect(mockUseWearableSamples).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'SLEEP_RECOVERY' }),
    );
  });
});
