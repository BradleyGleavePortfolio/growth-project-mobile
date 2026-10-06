/**
 * B-HC12-121 (C-370-3): Apple Health posts each night once, whole, from the
 * one import piece in which it ends. Runs through the REAL HealthKitClient
 * (only the `react-native-health` native module is faked), so the real 36 h
 * sleep look-back and sleep window run in every piece. The fake readers
 * select a sample by its START in [startDate, endDate)
 * (HKQueryOptionStrictStartDate). Synthetic data only.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native-health', () => {
  const native = {
    initHealthKit: jest.fn(),
    getDailyStepCountSamples: jest.fn(),
    getActiveEnergyBurned: jest.fn(),
    getRestingHeartRateSamples: jest.fn(),
    getHeartRateSamples: jest.fn(),
    getVo2MaxSamples: jest.fn(),
    getAnchoredWorkouts: jest.fn(),
    getWeightSamples: jest.fn(),
    getBodyFatPercentageSamples: jest.fn(),
    getBloodPressureSamples: jest.fn(),
    getSleepSamples: jest.fn(),
    getHeartRateVariabilitySamples: jest.fn(),
    getOxygenSaturationSamples: jest.fn(),
    getRespiratoryRateSamples: jest.fn(),
    getBodyTemperatureSamples: jest.fn(),
  };
  return Object.assign(native, { __esModule: true, default: native });
});

const mockPost = jest.fn();
jest.mock('../../../api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args) },
}));

import { HealthKitClient } from '../healthKitClient';
import { HEALTHKIT_METRIC_KEYS, HealthKitSyncService } from '../healthKitSyncService';
import { setSyncProgress, type OnDeviceScope } from '../../onDeviceState';
import type { SessionFence } from '../../sessionFence';

type Native = Record<string, jest.Mock>;
const native = jest.requireMock('react-native-health') as unknown as Native;
const HOUR = 60 * 60_000;
const SCOPE: OnDeviceScope = { userId: 'hc12-hk', connectionId: 'conn-hc12', source: 'APPLE_HEALTHKIT' };

interface Sample {
  value: number | string;
  startDate: string;
  endDate: string;
}
interface Opts {
  startDate: string;
  endDate: string;
}
type Cb = (e: string | null, r: unknown) => void;

function byStart(samples: Sample[]) {
  return (o: Opts, cb: Cb) => {
    const s = Date.parse(o.startDate);
    const e = Date.parse(o.endDate);
    cb(
      null,
      samples.filter((x) => {
        const t = Date.parse(x.startDate);
        return t >= s && t < e;
      }),
    );
  };
}

function okFence(): SessionFence {
  return {
    userId: SCOPE.userId,
    assertCurrent: jest.fn(async () => undefined),
    throwIfStopped: jest.fn(),
    cancel: jest.fn(),
  };
}

async function seedAllThrough(iso: string) {
  const completedThrough: Record<string, string> = {};
  for (const k of HEALTHKIT_METRIC_KEYS) completedThrough[k] = iso;
  await setSyncProgress(SCOPE, { v: 1, completedThrough, resume: {} });
}

type Wire = { metric: string; value: number; startAt: string; endAt: string };
const posted = (): Wire[] => mockPost.mock.calls.flatMap((call) => call[1] as Wire[]);
const sleepTotals = (): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  for (const s of posted().filter((x) => x.metric === 'SLEEP_TOTAL_MIN')) {
    const key = `${s.startAt}|${s.endAt}`;
    out.set(key, [...(out.get(key) ?? []), s.value]);
  }
  return out;
};

/** One night 22:00 -> 06:00 (UTC) as eight hourly stage segments (480 min asleep). */
function night(dayIso: string): Sample[] {
  const start = Date.parse(`${dayIso}T22:00:00.000Z`);
  const stages = ['CORE', 'DEEP', 'REM', 'CORE', 'DEEP', 'REM', 'CORE', 'CORE'];
  return stages.map((value, i) => ({
    value,
    startDate: new Date(start + i * HOUR).toISOString(),
    endDate: new Date(start + (i + 1) * HOUR).toISOString(),
  }));
}
const nightKey = (dayIso: string): string => {
  const s = `${dayIso}T22:00:00.000Z`;
  return `${s}|${new Date(Date.parse(s) + 8 * HOUR).toISOString()}`;
};

const ORIGINAL_TZ = process.env.TZ;

beforeEach(async () => {
  process.env.TZ = 'UTC';
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  mockPost.mockResolvedValue({ data: { inserted: 1, skipped: 0 } });
  native.initHealthKit.mockImplementation((_p: unknown, cb: Cb) => cb(null, true));
  for (const k of Object.keys(native)) {
    if (k === 'initHealthKit' || k === 'getAnchoredWorkouts' || typeof native[k]?.mockImplementation !== 'function') continue;
    native[k].mockImplementation((_o: Opts, cb: Cb) => cb(null, []));
  }
  native.getAnchoredWorkouts.mockImplementation((_o: unknown, cb: Cb) => cb(null, { anchor: '', data: [] }));
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe('HC12-HK-1 (C-370-3, failing before): a tail cut by a piece look-back is not posted again', () => {
  it('330 + 180 minutes for one night counts once (Opus H9-HK-4 at the fixed contract)', async () => {
    const NOW = new Date('2026-06-10T12:00:00.000Z');
    // Window start 2026-06-06 12:00: pieces at 12:00, the third piece's sleep look-back starts at 06-07 00:00,
    // after the long first segment began, so that piece sees only the night's 180-minute tail.
    await seedAllThrough('2026-06-07T12:00:00.000Z');
    const s1: Sample = { value: 'ASLEEP', startDate: '2026-06-06T23:00:00.000Z', endDate: '2026-06-07T01:30:00.000Z' };
    const s2: Sample = { value: 'ASLEEP', startDate: '2026-06-07T03:00:00.000Z', endDate: '2026-06-07T06:00:00.000Z' };
    native.getSleepSamples.mockImplementation(byStart([s1, s2]));
    const result = await new HealthKitSyncService(new HealthKitClient()).sync({ scope: SCOPE, now: NOW, fence: okFence() });
    expect(Object.fromEntries(sleepTotals())).toEqual({
      '2026-06-06T23:00:00.000Z|2026-06-07T06:00:00.000Z': [330],
    });
    expect(result.complete).toBe(true);
  });
});

describe('HC12-HK-2: every night is posted whole, once per run, across consecutive runs', () => {
  it('pieces ending inside nights post each night once; the next run posts only the night after', async () => {
    const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10'];
    native.getSleepSamples.mockImplementation(byStart(days.flatMap(night)));
    // Progress 03:30 -> window start 03:00: every piece ends mid-night (Opus H9-HK-1 setup).
    await seedAllThrough('2026-06-06T03:30:00.000Z');
    const svc = new HealthKitSyncService(new HealthKitClient());
    await svc.sync({ scope: SCOPE, now: new Date('2026-06-10T12:00:00.000Z'), fence: okFence() });
    const first = sleepTotals();
    // Each night once, whole (480 min), from the piece in which it ends. The 06-03 night ended 21 h before
    // this window (an earlier run posted it); H9-HK-1 expected it again from the first piece's look-back.
    expect([...first.keys()].sort()).toEqual(['2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09'].map(nightKey));
    for (const values of first.values()) expect(values).toEqual([480]);

    mockPost.mockClear();
    await svc.sync({ scope: SCOPE, now: new Date('2026-06-11T12:00:00.000Z'), fence: okFence() });
    const second = sleepTotals();
    // The look-back day re-posts the 06-09 night under the same key (the backend skips it); the
    // 06-10 night is new; no tail or partial of any night appears.
    expect([...second.keys()].sort()).toEqual(['2026-06-09', '2026-06-10'].map(nightKey));
    for (const values of second.values()) expect(values).toEqual([480]);
  });

  it('a night that ends within 2 h of the run end waits for the next run (no gap between runs)', async () => {
    native.getSleepSamples.mockImplementation(byStart(night('2026-06-09')));
    // A heart rate makes the first run post and save progress through its end (07:00).
    const hr: Sample = { value: 58, startDate: '2026-06-10T00:00:00.000Z', endDate: '2026-06-10T00:00:00.000Z' };
    native.getHeartRateSamples.mockImplementation(byStart([hr]));
    await seedAllThrough('2026-06-09T12:00:00.000Z');
    const svc = new HealthKitSyncService(new HealthKitClient());
    const first = await svc.sync({ scope: SCOPE, now: new Date('2026-06-10T07:00:00.000Z'), fence: okFence() });
    expect(first.cursorAdvanced).toBe(true);
    expect(sleepTotals().size).toBe(0);
    mockPost.mockClear();
    await svc.sync({ scope: SCOPE, now: new Date('2026-06-10T09:00:00.000Z'), fence: okFence() });
    expect(Object.fromEntries(sleepTotals())).toEqual({ [nightKey('2026-06-09')]: [480] });
  });
});

describe('HC12-HK-3 (C-370-2): one pacer for the run', () => {
  it('passes the run pacer to every post and waits through it', async () => {
    const heartRate: Sample[] = Array.from({ length: 600 }, (_, i) => {
      const t = new Date(Date.parse('2026-06-10T00:00:00.000Z') + i * 5_000).toISOString();
      return { value: 60, startDate: t, endDate: t };
    });
    native.getHeartRateSamples.mockImplementation(byStart(heartRate));
    await seedAllThrough('2026-06-10T10:00:00.000Z');
    const acquire = jest.fn(async () => undefined);
    const pacer = { acquire, hold: jest.fn(), backOff: jest.fn(async () => undefined) };
    await new HealthKitSyncService(new HealthKitClient()).sync({
      scope: SCOPE,
      now: new Date('2026-06-10T12:00:00.000Z'),
      fence: okFence(),
      ingestDeps: { pacer },
    });
    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(acquire).toHaveBeenCalledTimes(3);
  });
});
