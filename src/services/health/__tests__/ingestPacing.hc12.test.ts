/**
 * B-HC12-121 (C-370-2): ingest requests stay under the backend's 60 per
 * minute and honour a 429's Retry-After. Time is a fake clock: `Date.now` is
 * replaced and every wait advances it by the time asked for.
 */

jest.mock('../../api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

import { AxiosError, AxiosHeaders } from 'axios';
import {
  INGEST_REQUESTS_PER_WINDOW,
  INGEST_WINDOW_MS,
  MAX_RETRY_WAIT_MS,
  createIngestPacer,
  postIngestBatches,
  retryWaitMs,
  type IngestableSample,
} from '../ingestBatching';

const T0 = Date.parse('2026-10-05T19:00:00.000Z');
let clock = T0;
const sleep = jest.fn(async (ms: number) => {
  clock += ms;
});

function sample(i: number): IngestableSample {
  return {
    connectionId: 'c1',
    provider: 'HEALTH_CONNECT',
    metric: 'HEART_RATE_BPM',
    bucket: 'HEALTH_FITNESS',
    value: 60 + (i % 50),
    unit: 'bpm',
    startAt: new Date(Date.UTC(2026, 9, 4, 0, 0, i * 5)),
    endAt: new Date(Date.UTC(2026, 9, 4, 0, 0, i * 5)),
  };
}

function rateLimited(retryAfter?: string): AxiosError {
  const headers = new AxiosHeaders();
  if (retryAfter !== undefined) headers.set('retry-after', retryAfter);
  return new AxiosError('rate limited', '429', undefined, undefined, {
    status: 429,
    statusText: 'Too Many Requests',
    headers,
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

/** Most requests sent in any 60-second window. */
function busiestWindow(times: number[]): number {
  let most = 0;
  for (const start of times) most = Math.max(most, times.filter((t) => t >= start && t < start + 60_000).length);
  return most;
}

beforeEach(() => {
  clock = T0;
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('HC12-PACE-1 (failing before): a large post never sends more than the window allows', () => {
  it('60 requests (15,000 samples) leave at most 50 per 60 s, and all of them are sent', async () => {
    const times: number[] = [];
    const post = jest.fn(async (_p: string, body: unknown[]) => {
      times.push(Date.now());
      return { data: { inserted: body.length, skipped: 0 } };
    });
    const res = await postIngestBatches(
      Array.from({ length: 15_000 }, (_, i) => sample(i)),
      { post, sleep },
    );
    expect(res.requests).toBe(60);
    expect(res.inserted).toBe(15_000);
    // Before the fix all 60 left at once, over the backend's 60-per-minute bucket edge.
    expect(busiestWindow(times)).toBeLessThanOrEqual(50);
    expect(times[50] - times[0]).toBe(60_000);
    expect([INGEST_REQUESTS_PER_WINDOW, INGEST_WINDOW_MS]).toEqual([50, 60_000]);
  });
});

describe('HC12-PACE-2 (failing before): Retry-After as an HTTP date', () => {
  it('waits until the date the server gave, not the full bound', async () => {
    const at = new Date(T0 + 20_000).toUTCString();
    const post = jest
      .fn()
      .mockRejectedValueOnce(rateLimited(at))
      .mockResolvedValueOnce({ data: { inserted: 1, skipped: 0 } });
    await postIngestBatches([sample(0)], { post, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(20_000);
  });

  it('reads seconds, dates, and bounds every wait by one bucket window', () => {
    expect(retryWaitMs(rateLimited('7'), T0)).toBe(7_000);
    expect(retryWaitMs(rateLimited('3600'), T0)).toBe(MAX_RETRY_WAIT_MS);
    expect(retryWaitMs(rateLimited(new Date(T0 + 5_000).toUTCString()), T0)).toBe(5_000);
    expect(retryWaitMs(rateLimited(new Date(T0 - 5_000).toUTCString()), T0)).toBe(0);
    expect(retryWaitMs(rateLimited('soon'), T0)).toBe(MAX_RETRY_WAIT_MS);
    expect(retryWaitMs(rateLimited(), T0)).toBe(MAX_RETRY_WAIT_MS);
    expect(retryWaitMs(new Error('network'), T0)).toBe(MAX_RETRY_WAIT_MS);
  });
});

describe('HC12-PACE-3: one pacer shared by two runs', () => {
  it('after a 429, no request from either run leaves before the Retry-After has passed', async () => {
    const pacer = createIngestPacer({ sleep });
    const times: Array<[string, number]> = [];
    let first = true;
    const postA = jest.fn(async () => {
      times.push(['a', Date.now()]);
      if (first) {
        first = false;
        throw rateLimited('30');
      }
      return { data: { inserted: 1, skipped: 0 } };
    });
    const postB = jest.fn(async () => {
      times.push(['b', Date.now()]);
      return { data: { inserted: 1, skipped: 0 } };
    });
    await postIngestBatches([sample(0)], { post: postA, pacer });
    await postIngestBatches([sample(1)], { post: postB, pacer });
    expect(times).toEqual([
      ['a', T0],
      ['a', T0 + 30_000],
      ['b', T0 + 30_000],
    ]);
  });

  it('a run stopped by repeated 429s leaves the hold for the next run', async () => {
    const pacer = createIngestPacer({ sleep });
    const post = jest.fn().mockRejectedValue(rateLimited('45'));
    await expect(postIngestBatches([sample(0)], { post, pacer })).rejects.toBeInstanceOf(AxiosError);
    expect(post).toHaveBeenCalledTimes(3);
    const stoppedAt = Date.now();
    const next = jest.fn(async () => ({ data: { inserted: 1, skipped: 0 } }));
    const sentAt: number[] = [];
    next.mockImplementation(async () => {
      sentAt.push(Date.now());
      return { data: { inserted: 1, skipped: 0 } };
    });
    await postIngestBatches([sample(1)], { post: next, pacer });
    expect(sentAt).toEqual([stoppedAt + 45_000]);
  });

  it('counts requests across runs in the same window', async () => {
    const pacer = createIngestPacer({ sleep });
    const times: number[] = [];
    const post = jest.fn(async () => {
      times.push(Date.now());
      return { data: { inserted: 1, skipped: 0 } };
    });
    for (let run = 0; run < 3; run += 1) {
      await postIngestBatches(Array.from({ length: 20 * 250 }, (_, i) => sample(i)), { post, pacer });
    }
    expect(times).toHaveLength(60);
    expect(busiestWindow(times)).toBeLessThanOrEqual(50);
  });

  it('a session stop while waiting sends nothing', async () => {
    const pacer = createIngestPacer({ sleep, limit: 1 });
    const post = jest.fn(async () => ({ data: { inserted: 1, skipped: 0 } }));
    let calls = 0;
    const beforeEachRequest = () => {
      calls += 1;
      if (calls === 2) throw new Error('session changed');
    };
    await expect(
      postIngestBatches(Array.from({ length: 300 }, (_, i) => sample(i)), { post, pacer, beforeEachRequest }),
    ).rejects.toThrow('session changed');
    expect(post).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(INGEST_WINDOW_MS);
  });
});
