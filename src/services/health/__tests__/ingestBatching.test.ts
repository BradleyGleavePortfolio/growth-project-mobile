/**
 * S14 — shared ingest wire + batching.
 */

jest.mock('../../api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

import { AxiosError, AxiosHeaders } from 'axios';
import {
  MAX_ATTEMPTS_PER_BATCH,
  MAX_REQUEST_BYTES,
  MAX_SAMPLES_PER_REQUEST,
  WEARABLES_INGEST_PATH,
  chunkForIngest,
  postIngestBatches,
  toIngestWire,
  type IngestableSample,
} from '../ingestBatching';

function sample(i: number, extra: Partial<IngestableSample> = {}): IngestableSample {
  return {
    connectionId: 'c1',
    provider: 'HEALTH_CONNECT',
    metric: 'HEART_RATE_BPM',
    bucket: 'HEALTH_FITNESS',
    value: 60 + (i % 50),
    unit: 'bpm',
    startAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
    endAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
    ...extra,
  };
}

function rateLimited(retryAfter?: string): AxiosError {
  const headers = new AxiosHeaders();
  if (retryAfter) headers.set('retry-after', retryAfter);
  return new AxiosError('rate limited', '429', undefined, undefined, {
    status: 429,
    statusText: 'Too Many Requests',
    headers,
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

describe('toIngestWire', () => {
  it('keeps only allow-listed keys and serializes dates', () => {
    const wire = toIngestWire({
      ...sample(0, { sourceRecordId: 'r1', sourceTz: null }),
      ...({ userId: 'u-from-caller' } as object),
    } as IngestableSample);
    expect(wire).not.toHaveProperty('userId');
    expect(wire).not.toHaveProperty('sourceTz');
    expect(wire.sourceRecordId).toBe('r1');
    expect(wire.startAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('passes string times through unchanged (Apple Health local-offset format)', () => {
    const wire = toIngestWire(
      sample(0, {
        startAt: '2026-09-29T07:00:00.000-0700',
        endAt: '2026-09-29T08:00:00.000-0700',
      }),
    );
    expect(wire.startAt).toBe('2026-09-29T07:00:00.000-0700');
  });
});

describe('chunkForIngest', () => {
  it('caps each batch by sample count', () => {
    const wire = Array.from({ length: 600 }, (_, i) => toIngestWire(sample(i)));
    const batches = chunkForIngest(wire);
    expect(batches.map((b) => b.length)).toEqual([
      MAX_SAMPLES_PER_REQUEST,
      MAX_SAMPLES_PER_REQUEST,
      600 - 2 * MAX_SAMPLES_PER_REQUEST,
    ]);
    expect(batches.flat()).toEqual(wire);
  });

  it('caps each batch by serialized size under the 100 KB body limit', () => {
    const big = 'x'.repeat(1500);
    const wire = Array.from({ length: 200 }, (_, i) =>
      toIngestWire(sample(i, { rawRef: big, sourceRecordId: big })),
    );
    const batches = chunkForIngest(wire);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      expect(JSON.stringify(b).length).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    }
    expect(batches.flat()).toHaveLength(200);
  });

  it('returns no batches for no samples', () => {
    expect(chunkForIngest([])).toEqual([]);
  });
});

describe('postIngestBatches', () => {
  it('posts batches sequentially and sums the counts', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ data: { inserted: 250, skipped: 0 } })
      .mockResolvedValueOnce({ data: { inserted: 40, skipped: 10 } });
    const res = await postIngestBatches(
      Array.from({ length: 300 }, (_, i) => sample(i)),
      { post },
    );
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe(WEARABLES_INGEST_PATH);
    expect(res).toEqual({ inserted: 290, skipped: 10, requests: 2 });
  });

  it('waits for Retry-After on 429 and retries the same batch', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(rateLimited('7'))
      .mockResolvedValueOnce({ data: { inserted: 1, skipped: 0 } });
    const sleep = jest.fn().mockResolvedValue(undefined);
    const res = await postIngestBatches([sample(0)], { post, sleep });
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);
    expect(res.inserted).toBe(1);
  });

  it('gives up after MAX_ATTEMPTS_PER_BATCH rate-limited attempts', async () => {
    const post = jest.fn().mockRejectedValue(rateLimited('1'));
    const sleep = jest.fn().mockResolvedValue(undefined);
    await expect(postIngestBatches([sample(0)], { post, sleep })).rejects.toBeInstanceOf(
      AxiosError,
    );
    expect(post).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_BATCH);
  });

  it('rejects immediately on any other failure', async () => {
    const post = jest.fn().mockRejectedValue(new Error('network'));
    const sleep = jest.fn();
    await expect(postIngestBatches([sample(0)], { post, sleep })).rejects.toThrow('network');
    expect(post).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
