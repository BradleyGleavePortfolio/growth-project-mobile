import type { WearableSamplesResponse } from '../../../../api/wearablesSamplesApi';
import { lastNightSleep } from '../homeRings';

const zone = 'America/Los_Angeles';
const data: WearableSamplesResponse = {
  version: 1, user_id: 'u1', bucket: 'SLEEP_RECOVERY',
  window: { from: '2026-10-02T07:00:00Z', to: '2026-10-10T07:00:00Z' },
  freshness: { providers: [] },
  series: [
    { metric: 'RECOVERY_SCORE', unit: 'score', provider_used: 'OURA', sample_count: 1,
      samples: [{ start_at: '2026-10-09T07:00:00Z', end_at: '2026-10-10T07:00:00Z', value: 78, provider: 'OURA' }] },
    { metric: 'SLEEP_DURATION_MIN', unit: 'min', provider_used: 'OURA', sample_count: 1,
      samples: [{ start_at: '2026-10-09T05:00:00Z', end_at: '2026-10-09T12:20:00Z', value: 440, provider: 'OURA' }] },
  ],
};

it('uses the score day and overnight wake day, not the bedtime day or score interval end', () => {
  expect(lastNightSleep(data, new Date('2026-10-09T20:00:00Z'), zone)).toEqual({ recovery: 78, asleepMin: 440 });
  expect(data.series[0]?.samples).toHaveLength(1); // cached response is not changed
});

it('drops yesterday at local midnight, not UTC midnight', () => {
  expect(lastNightSleep(data, new Date('2026-10-10T06:59:59Z'), zone)).toEqual({ recovery: 78, asleepMin: 440 });
  expect(lastNightSleep(data, new Date('2026-10-10T07:00:00Z'), zone)).toEqual({ recovery: null, asleepMin: null });
});

it('does not show a future day just before local midnight; shows it after midnight', () => {
  expect(lastNightSleep(data, new Date('2026-10-09T06:59:59Z'), zone)).toEqual({ recovery: null, asleepMin: null });
  expect(lastNightSleep(data, new Date('2026-10-09T07:00:00Z'), zone)).toEqual({ recovery: 78, asleepMin: 440 });
});

it('re-evaluates the same cached samples in the current device zone after travel', () => {
  const now = new Date('2026-10-10T00:30:00Z');
  expect(lastNightSleep(data, now, zone)).toEqual({ recovery: 78, asleepMin: 440 });
  expect(lastNightSleep(data, now, 'Asia/Tokyo')).toEqual({ recovery: null, asleepMin: null });
  expect(lastNightSleep(data, now, zone)).toEqual({ recovery: 78, asleepMin: 440 });
});

it('filters each metric before falling back, never pairing a fresh score with old sleep stages', () => {
  const mixed: WearableSamplesResponse = { ...data, series: [
    { ...data.series[0]!, samples: [{ ...data.series[0]!.samples[0]!, start_at: '2026-10-08T07:00:00Z' }] },
    { ...data.series[0]!, metric: 'READINESS_SCORE' },
    { ...data.series[1]!, metric: 'SLEEP_LIGHT_MIN' },
    { ...data.series[1]!, metric: 'SLEEP_DEEP_MIN',
      samples: [{ ...data.series[1]!.samples[0]!, end_at: '2026-10-08T12:20:00Z' }] },
  ] };
  expect(lastNightSleep(mixed, new Date('2026-10-09T20:00:00Z'), zone)).toEqual({ recovery: 78, asleepMin: 440 });
});

it('has no current night for an older-only or absent response', () => {
  expect(lastNightSleep(data, new Date('2026-10-11T20:00:00Z'), zone)).toEqual({ recovery: null, asleepMin: null });
  expect(lastNightSleep(undefined, new Date('2026-10-09T20:00:00Z'), zone)).toEqual({ recovery: null, asleepMin: null });
});

it('uses current total sleep when the preferred duration is from an older night', () => {
  const mixed: WearableSamplesResponse = { ...data, series: [
    { ...data.series[1]!, samples: [{ ...data.series[1]!.samples[0]!, end_at: '2026-10-08T12:20:00Z' }] },
    { ...data.series[1]!, metric: 'SLEEP_TOTAL_MIN' },
  ] };
  expect(lastNightSleep(mixed, new Date('2026-10-09T20:00:00Z'), zone)).toEqual({ recovery: null, asleepMin: 440 });
});
