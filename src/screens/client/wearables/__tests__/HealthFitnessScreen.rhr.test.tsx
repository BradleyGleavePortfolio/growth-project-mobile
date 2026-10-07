/**
 * S14 — the Health view's Heart card reads resting heart rate from the bucket
 * the server actually stores it in (SLEEP_RECOVERY), and the metric detail
 * link uses that bucket (the server rejects a metric outside its bucket).
 */

import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockUseWearableSamples = jest.fn();
jest.mock('../../../../hooks/useWearableSamples', () => ({
  useWearableSamples: (...args: unknown[]) => mockUseWearableSamples(...args),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../components/useReduceMotion', () => ({
  useReduceMotion: () => true,
}));

jest.mock('../cards/HeartCard', () => {
  const ReactLocal = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({
      rhrSeries,
      onPress,
    }: {
      rhrSeries?: { samples: { value: number }[] };
      onPress?: () => void;
    }) =>
      ReactLocal.createElement(
        Pressable,
        { onPress, accessibilityLabel: 'heart-card' },
        ReactLocal.createElement(
          Text,
          null,
          `RHR_${rhrSeries ? rhrSeries.samples.map((s) => s.value).join(',') : 'none'}`,
        ),
      ),
  };
});

jest.mock('../cards/ThreeRingHero', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement(Text, null, 'RINGS'),
  };
});
jest.mock('../cards/WorkoutsCard', () => {
  const ReactLocal = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ onPress }: { onPress?: () => void }) =>
      ReactLocal.createElement(Pressable, { onPress, accessibilityLabel: 'WORKOUTS' }),
  };
});
jest.mock('../cards/BodyCard', () => {
  const ReactLocal = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ onPress }: { onPress?: () => void }) =>
      ReactLocal.createElement(Pressable, { onPress, accessibilityLabel: 'BODY' }),
  };
});
jest.mock('../cards/FitnessTrendCard', () => {
  const ReactLocal = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ onPress }: { onPress?: () => void }) =>
      ReactLocal.createElement(Pressable, { onPress, accessibilityLabel: 'TREND' }),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import HealthFitnessScreen from '../HealthFitnessScreen';
import { STARTER_GOALS } from '../starterGoals';

function series(metric: string, values: number[]) {
  return {
    metric,
    unit: metric === 'STEPS' ? 'count' : 'bpm',
    provider_used: 'APPLE_HEALTHKIT',
    sample_count: values.length,
    samples: values.map((value, i) => ({
      start_at: `2026-09-2${i}T00:00:00.000Z`,
      end_at: `2026-09-2${i}T00:00:00.000Z`,
      value,
      provider: 'APPLE_HEALTHKIT',
    })),
  };
}

function response(bucket: string, s: ReturnType<typeof series>[]) {
  return {
    bucket,
    window: {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    },
    series: s,
    freshness: [],
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockUseWearableSamples.mockImplementation((params: { bucket: string; metric?: string }) => ({
    data:
      params.bucket === 'SLEEP_RECOVERY'
        ? response('SLEEP_RECOVERY', [series('RESTING_HEART_RATE_BPM', [55, 54])])
        : response('HEALTH_FITNESS', [series('STEPS', [8000, 9000])]),
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  }));
});

describe('HealthFitnessScreen resting heart rate (S14)', () => {
  it('reads RESTING_HEART_RATE_BPM by metric from the SLEEP_RECOVERY bucket', async () => {
    await render(<HealthFitnessScreen />);
    expect(mockUseWearableSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'SLEEP_RECOVERY',
        metric: 'RESTING_HEART_RATE_BPM',
      }),
    );
    expect(screen.getByText('RHR_55,54')).toBeTruthy();
  });

  it('opens the metric detail in the SLEEP_RECOVERY bucket', async () => {
    await render(<HealthFitnessScreen />);
    await fireEvent.press(screen.getByLabelText('heart-card'));
    expect(mockNavigate).toHaveBeenCalledWith(
      'WearableMetricDetail',
      expect.objectContaining({
        metric: 'RESTING_HEART_RATE_BPM',
        bucket: 'SLEEP_RECOVERY',
      }),
    );
  });

  it('dates the real activity values and labels the owner-approved Starter goals', async () => {
    await render(<HealthFitnessScreen />);
    expect(screen.getByText('Steps')).toBeTruthy();
    expect(screen.getByText('9,000 steps')).toBeTruthy();
    expect(screen.getByText('Mon 21 Sept')).toBeTruthy();
    expect(screen.getByText('Starter goal: 5,000 steps')).toBeTruthy();
    expect(screen.getByText('Starter goal: 20 min')).toBeTruthy();
    expect(screen.getByText('Starter goal: 250 kcal')).toBeTruthy();
    expect(screen.queryByText('Stand')).toBeNull();
  });

  it('keeps all four metric taps and their original routes reachable', async () => {
    await render(<HealthFitnessScreen />);
    for (const [label, metric] of [
      ['heart-card', 'RESTING_HEART_RATE_BPM'], ['WORKOUTS', 'WORKOUT_DURATION_MIN'],
      ['BODY', 'BODY_WEIGHT_KG'], ['TREND', 'STEPS'],
    ]) {
      await fireEvent.press(screen.getByLabelText(label));
      expect(mockNavigate).toHaveBeenLastCalledWith('WearableMetricDetail',
        expect.objectContaining({ metric, bucket: metric === 'RESTING_HEART_RATE_BPM' ? 'SLEEP_RECOVERY' : 'HEALTH_FITNESS' }));
    }
  });

  it('keeps the coach embed read-only', async () => {
    await render(<HealthFitnessScreen clientId="client-fixture" aiPanelSlot={<Text>AI panel fixture</Text>} />);
    expect(screen.getByText('AI panel fixture')).toBeTruthy();
    for (const label of ['heart-card', 'WORKOUTS', 'BODY', 'TREND']) {
      expect(screen.getByLabelText(label).props.onPress).toBeUndefined();
    }
    expect(screen.queryByLabelText('Connect a tracker')).toBeNull();
  });

  it('uses real targets before Starter goals, independently per metric', async () => {
    await render(<HealthFitnessScreen targets={{ STEPS: 7000, WORKOUT_DURATION_MIN: 25 }} />);
    expect(screen.getByText('Goal: 7,000 steps')).toBeTruthy();
    expect(screen.getByText('Goal: 25 min')).toBeTruthy();
    expect(screen.queryByText('Starter goal: 5,000 steps')).toBeNull();
    expect(screen.getByText('Starter goal: 250 kcal')).toBeTruthy();
    expect(screen.getByLabelText('Steps progress').props.accessibilityValue).toEqual(
      { min: 0, max: 7000, now: 7000, text: '9,000 steps' });
  });

  it('no data keeps connect navigation, absent values and the single goal constants', async () => {
    expect(STARTER_GOALS).toEqual({ STEPS: 5000, WORKOUT_DURATION_MIN: 20, ACTIVE_ENERGY_KCAL: 250 });
    mockUseWearableSamples.mockReturnValue({ data: response('HEALTH_FITNESS', []), isLoading: false });
    await render(<HealthFitnessScreen />);
    expect(screen.getAllByText('No sample yet')).toHaveLength(3);
    await fireEvent.press(screen.getByLabelText('Connect a tracker'));
    expect(mockNavigate).toHaveBeenCalledWith('Connections');
  });

  it('no-data coach embed keeps the bars without a connect action', async () => {
    mockUseWearableSamples.mockReturnValue({ data: response('HEALTH_FITNESS', []), isLoading: false });
    await render(<HealthFitnessScreen clientId="client-fixture" />);
    expect(screen.getAllByText('No sample yet')).toHaveLength(3);
    expect(screen.getByText('No health data from this client yet')).toBeTruthy();
    expect(screen.queryByLabelText('Connect a tracker')).toBeNull();
  });

  it('uses each aggregated sample value and date, not the window end or raw values', async () => {
    const activity = [
      ['ACTIVE_ENERGY_KCAL', 125, '2026-10-06'], ['WORKOUT_DURATION_MIN', 10, '2026-10-05'],
      ['STEPS', 2500, '2026-10-04'],
    ].map(([metric, value, day]) => ({
      ...series(String(metric), [999]),
      buckets: [{ bucket_start: `${day}T00:00:00Z`, bucket_end: `${day}T23:59:59Z`, agg: value, count: 1 }],
    }));
    mockUseWearableSamples.mockReturnValue({ data: response('HEALTH_FITNESS', activity), isLoading: false });
    await render(<HealthFitnessScreen />);
    for (const text of ['125 kcal', '10 min', '2,500 steps', 'Tue 6 Oct', 'Mon 5 Oct', 'Sun 4 Oct']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByLabelText('Active energy progress').props.accessibilityValue.now).toBe(125);
  });

  it('loading, refresh and retry remain real states/actions', async () => {
    mockUseWearableSamples.mockReturnValue({ isLoading: true });
    await render(<HealthFitnessScreen />);
    expect(screen.getByLabelText('Loading your fitness overview')).toBeTruthy();
    expect(screen.getAllByText('No sample yet')).toHaveLength(3);
    const refetch = jest.fn();
    mockUseWearableSamples.mockReturnValue({ isLoading: false, isError: true, refetch });
    await render(<HealthFitnessScreen />);
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(refetch).toHaveBeenCalledTimes(1);
    mockUseWearableSamples.mockReturnValue({ data: response('HEALTH_FITNESS', [series('STEPS', [2500])]), refetch });
    await render(<HealthFitnessScreen />);
    let scroll = screen.getByText('2,500 steps').parent;
    while (scroll && !scroll.props.refreshControl) scroll = scroll.parent;
    expect(scroll?.props.refreshControl).toBeTruthy();
    await act(async () => scroll?.props.refreshControl.props.onRefresh());
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('cached errors name saved samples without inventing a last-sync time', async () => {
    mockUseWearableSamples.mockReturnValue({ data: response('HEALTH_FITNESS', [series('STEPS', [2500])]), isError: true });
    await render(<HealthFitnessScreen />);
    expect(screen.getByText('Health data did not refresh. Showing saved samples.')).toBeTruthy();
    expect(screen.queryByText(/last synced data from/)).toBeNull();
  });
});
