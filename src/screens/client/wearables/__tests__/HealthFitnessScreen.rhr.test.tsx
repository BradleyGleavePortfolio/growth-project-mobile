/**
 * S14 — the Health view's Heart card reads resting heart rate from the bucket
 * the server actually stores it in (SLEEP_RECOVERY), and the metric detail
 * link uses that bucket (the server rejects a metric outside its bucket).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

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
      onPress: () => void;
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
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement(Text, null, 'WORKOUTS'),
  };
});
jest.mock('../cards/BodyCard', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement(Text, null, 'BODY'),
  };
});
jest.mock('../cards/FitnessTrendCard', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement(Text, null, 'TREND'),
  };
});
jest.mock('../empty/HealthFitnessEmptyState', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement(Text, null, 'EMPTY'),
  };
});

import HealthFitnessScreen from '../HealthFitnessScreen';

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
});
