// PR-HK-2.b — healthConnectIngestApi tests.
//
// Verifies the wire serialization (Date → ISO), the no-op-on-empty contract,
// and that the shared axios instance is used to POST the canonical path.

jest.mock('../../../api', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

import api from '../../../api';
import {
  WEARABLES_INGEST_PATH,
  healthConnectIngestApi,
  toWire,
} from '../healthConnectIngestApi';
import type { NormalizedSample } from '../types';

const mockedPost = (api as unknown as { post: jest.Mock }).post;

function sample(): NormalizedSample {
  return {
    connectionId: 'c1',
    provider: 'HEALTH_CONNECT',
    metric: 'STEPS',
    bucket: 'HEALTH_FITNESS',
    value: 100,
    unit: 'count',
    startAt: new Date('2026-05-01T08:00:00.000Z'),
    endAt: new Date('2026-05-01T09:00:00.000Z'),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('toWire', () => {
  it('serializes Date fields to ISO strings', () => {
    const w = toWire(sample());
    expect(w.startAt).toBe('2026-05-01T08:00:00.000Z');
    expect(w.endAt).toBe('2026-05-01T09:00:00.000Z');
    expect(w.metric).toBe('STEPS');
  });
});

describe('ingest', () => {
  it('no-ops on an empty batch (no request)', async () => {
    const res = await healthConnectIngestApi.ingest([]);
    expect(res).toEqual({ inserted: 0, skipped: 0 });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('POSTs serialized samples to the canonical path and returns the result', async () => {
    mockedPost.mockResolvedValue({ data: { inserted: 1, skipped: 0 } });
    const res = await healthConnectIngestApi.ingest([sample()]);
    expect(mockedPost).toHaveBeenCalledWith(WEARABLES_INGEST_PATH, [
      expect.objectContaining({
        startAt: '2026-05-01T08:00:00.000Z',
        endAt: '2026-05-01T09:00:00.000Z',
        metric: 'STEPS',
      }),
    ]);
    expect(res).toEqual({ inserted: 1, skipped: 0 });
  });

  it('S14: never sends userId, even if a caller object carries one', async () => {
    mockedPost.mockResolvedValue({ data: { inserted: 1, skipped: 0 } });
    const withUser = { ...sample(), userId: 'someone-else' };
    await healthConnectIngestApi.ingest([withUser]);
    const body = mockedPost.mock.calls[0][1] as Record<string, unknown>[];
    expect(body[0]).not.toHaveProperty('userId');
    expect(Object.keys(body[0]).sort()).toEqual(
      ['bucket', 'connectionId', 'endAt', 'metric', 'provider', 'startAt', 'unit', 'value'].sort(),
    );
  });
});
