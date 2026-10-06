/**
 * H8 — HealthKit late data (C-360-1) and resumable import (C-360-2).
 *
 * A fake Apple Health store answers each read the way the native queries do:
 * a sample is returned when its START lies in [since, until)
 * (HKQueryOptionStrictStartDate), and an hourly sum only once its hour ended
 * by `until`. Progress lives in the (jest) AsyncStorage via
 * `../../onDeviceState`; the axios `api.post` is stubbed.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HealthKitQueryWindow, HealthKitReadResult, HealthKitSample } from '../healthKitClient';

const mockPost = jest.fn();
jest.mock('../../../api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args) },
}));

import {
  CUMULATIVE_SETTLE_MINUTES,
  HEALTHKIT_METRIC_KEYS,
  HealthKitSyncService,
  IMPORT_PIECE_HOURS,
  floorToLocalHour,
} from '../healthKitSyncService';
import { getSyncProgress, setSyncProgress, type OnDeviceScope } from '../../onDeviceState';
import { OnDeviceSessionChangedError, type SessionFence } from '../../sessionFence';

const SCOPE: OnDeviceScope = { userId: 'user-a', connectionId: 'conn-1', source: 'APPLE_HEALTHKIT' };
const HOUR = 60 * 60_000;
const NOW = new Date('2026-05-31T12:00:00.000Z');

type Store = { heartRate?: HealthKitSample[]; steps?: HealthKitSample[]; weight?: HealthKitSample[] };

/** A fake store whose reads honour each window (see the header). */
function makeClient(store: Store) {
  const inWindow = (w: HealthKitQueryWindow) => (s: HealthKitSample) => {
    const start = Date.parse(s.startDate);
    return start >= w.since.getTime() && start < w.until.getTime();
  };
  return {
    requestAuth: jest.fn(async (_types?: unknown): Promise<void> => undefined),
    readSamples: jest.fn(
      async (w: HealthKitQueryWindow): Promise<HealthKitReadResult> => ({
        heartRate: (store.heartRate ?? []).filter(inWindow(w)),
        weight: (store.weight ?? []).filter(inWindow(w)),
        steps: (store.steps ?? [])
          .filter(inWindow(w))
          .filter((b) => Date.parse(b.endDate) <= w.until.getTime()),
      }),
    ),
  };
}

const hr = (iso: string, value = 70): HealthKitSample => ({ value, startDate: iso, endDate: iso });
const stepsHour = (startIso: string, value: number): HealthKitSample => ({
  value,
  startDate: startIso,
  endDate: new Date(Date.parse(startIso) + HOUR).toISOString(),
});

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

type Posted = { metric: string; value: number; startAt: string };
const posted = (): Posted[] => mockPost.mock.calls.flatMap((call) => call[1] as Posted[]);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  mockPost.mockResolvedValue({ data: { accepted: 1 } });
});

describe('C-360-1: a sample that reaches Apple Health after the last sync is still read', () => {
  it('a watch heart rate that synced 5 hours late is posted on the next refresh', async () => {
    await seedAllThrough('2026-05-31T10:25:00.000Z');
    const client = makeClient({ heartRate: [hr('2026-05-31T06:00:00.000Z', 64)] });
    await new HealthKitSyncService(client as never).sync({ scope: SCOPE, now: NOW, fence: okFence() });
    expect(posted()).toEqual([
      expect.objectContaining({ metric: 'HEART_RATE_BPM', value: 64, startAt: '2026-05-31T06:00:00.000Z' }),
    ]);
  });

  it('an hourly steps sum waits to settle, then posts once with the late watch share included', async () => {
    const lastHour = floorToLocalHour(new Date(NOW.getTime() - HOUR)).toISOString();
    // A heart rate in the same hour, so the run posts and saves progress.
    const store: Store = { steps: [stepsHour(lastHour, 100)], heartRate: [hr(lastHour)] };
    const first = makeClient(store);
    await new HealthKitSyncService(first as never).sync({ scope: SCOPE, now: NOW, fence: okFence() });
    expect(posted().filter((s) => s.metric === 'STEPS')).toEqual([]);
    const settled = floorToLocalHour(new Date(NOW.getTime() - CUMULATIVE_SETTLE_MINUTES * 60_000));
    const saved = await getSyncProgress(SCOPE);
    expect(Date.parse(saved.completedThrough.steps)).toBeLessThanOrEqual(settled.getTime());

    // The watch's share of that hour arrives; the next refresh is after it settles.
    store.steps = [stepsHour(lastHour, 160)];
    const later = new Date(NOW.getTime() + CUMULATIVE_SETTLE_MINUTES * 60_000 + HOUR);
    await new HealthKitSyncService(makeClient(store) as never).sync({ scope: SCOPE, now: later, fence: okFence() });
    expect(posted().filter((s) => s.metric === 'STEPS').map((s) => s.value)).toEqual([160]);
  });
});

describe('C-360-2: progress is saved after every day-sized piece, so an interrupted import resumes', () => {
  /** One heart-rate sample at the start of each of the first `n` pieces of a 30-day import. */
  function importStore(n: number): { store: Store; since: Date } {
    const since = floorToLocalHour(new Date(NOW.getTime() - 30 * 24 * HOUR));
    const heartRate = Array.from({ length: n }, (_, i) =>
      hr(new Date(since.getTime() + i * IMPORT_PIECE_HOURS * HOUR + HOUR).toISOString(), 60 + i),
    );
    return { store: { heartRate }, since };
  }
  const pieceEndAfter = (since: Date, pieces: number) =>
    floorToLocalHour(new Date(since.getTime() + pieces * IMPORT_PIECE_HOURS * HOUR));

  it('reads oldest first in contiguous pieces of at most one day, ending at now', async () => {
    const { store, since } = importStore(3);
    const client = makeClient(store);
    await new HealthKitSyncService(client as never).sync({ scope: SCOPE, now: NOW, fence: okFence() });
    const windows = client.readSamples.mock.calls.map(([w]) => w);
    expect(windows[0].since.toISOString()).toBe(since.toISOString());
    expect(windows[windows.length - 1].until.toISOString()).toBe(NOW.toISOString());
    windows.forEach((w, i) => {
      expect(w.until.getTime() - w.since.getTime()).toBeLessThanOrEqual(IMPORT_PIECE_HOURS * HOUR);
      if (i > 0) expect(w.since.getTime()).toBe(windows[i - 1].until.getTime());
    });
    expect(posted().map((s) => s.value)).toEqual([60, 61, 62]);
  });

  it('a failed POST in piece 3 keeps pieces 1 and 2 saved; the next run starts from there', async () => {
    const { store, since } = importStore(3);
    mockPost
      .mockResolvedValueOnce({ data: { accepted: 1 } })
      .mockResolvedValueOnce({ data: { accepted: 1 } })
      .mockRejectedValueOnce(new Error('500 ingest down'));
    await expect(
      new HealthKitSyncService(makeClient(store) as never).sync({ scope: SCOPE, now: NOW, fence: okFence() }),
    ).rejects.toThrow('500 ingest down');
    const through = pieceEndAfter(since, 2).toISOString();
    expect((await getSyncProgress(SCOPE)).completedThrough.heartRate).toBe(through);

    const again = makeClient(store);
    await new HealthKitSyncService(again as never).sync({ scope: SCOPE, now: NOW, fence: okFence() });
    expect(again.readSamples.mock.calls[0][0].since.getTime()).toBeGreaterThan(since.getTime());
    expect((await getSyncProgress(SCOPE)).completedThrough.heartRate).toBe(NOW.toISOString());
  });

  it('a failed native read in piece 3 keeps pieces 1 and 2 saved', async () => {
    const { store, since } = importStore(3);
    const client = makeClient(store);
    const inner = client.readSamples.getMockImplementation()!;
    let reads = 0;
    client.readSamples.mockImplementation(async (w) => {
      reads += 1;
      if (reads === 3) throw new Error('read failed');
      return inner(w);
    });
    await expect(
      new HealthKitSyncService(client as never).sync({ scope: SCOPE, now: NOW, fence: okFence() }),
    ).rejects.toThrow('read failed');
    expect((await getSyncProgress(SCOPE)).completedThrough.heartRate).toBe(pieceEndAfter(since, 2).toISOString());
  });

  it('a metric that fails in piece 2 keeps its progress for the rest of the run; the others reach now', async () => {
    const { store, since } = importStore(3);
    const client = makeClient(store);
    const inner = client.readSamples.getMockImplementation()!;
    let reads = 0;
    client.readSamples.mockImplementation(async (w) => {
      reads += 1;
      const out = await inner(w);
      return reads === 2 ? { ...out, failed: ['weight'] } : out;
    });
    const res = await new HealthKitSyncService(client as never).sync({ scope: SCOPE, now: NOW, fence: okFence() });
    expect(res.complete).toBe(false);
    const saved = await getSyncProgress(SCOPE);
    expect(saved.completedThrough.weight).toBe(pieceEndAfter(since, 1).toISOString());
    expect(saved.completedThrough.heartRate).toBe(NOW.toISOString());
  });

  it('sign-out while piece 2 is read keeps piece 1 saved and sends nothing more', async () => {
    const { store, since } = importStore(3);
    let stopped = false;
    const fence: SessionFence = {
      userId: SCOPE.userId,
      assertCurrent: jest.fn(async () => {
        if (stopped) throw new OnDeviceSessionChangedError();
      }),
      throwIfStopped: jest.fn(() => {
        if (stopped) throw new OnDeviceSessionChangedError();
      }),
      cancel: jest.fn(),
    };
    const client = makeClient(store);
    const inner = client.readSamples.getMockImplementation()!;
    let reads = 0;
    client.readSamples.mockImplementation(async (w) => {
      reads += 1;
      if (reads === 2) stopped = true; // Log out tapped while piece 2 was read
      return inner(w);
    });
    await expect(
      new HealthKitSyncService(client as never).sync({ scope: SCOPE, now: NOW, fence }),
    ).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    expect(client.readSamples).toHaveBeenCalledTimes(2);
    expect(posted().map((s) => s.value)).toEqual([60]);
    expect((await getSyncProgress(SCOPE)).completedThrough.heartRate).toBe(pieceEndAfter(since, 1).toISOString());
  });
});
