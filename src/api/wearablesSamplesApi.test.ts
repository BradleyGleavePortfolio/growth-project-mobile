/**
 * wearablesSamplesApi — wire-contract tests against backend PR-HK-3a.
 *
 * Mocks the axios instance at `../services/api` (the repo's established test
 * seam — see wearablesConnectionsApi.test.ts) and asserts, for EVERY endpoint:
 *   • the exact URL + HTTP method + params/payload mobile sends, and
 *   • a Zod parse-SUCCESS path (valid backend shape → typed object), and
 *   • a Zod parse-FAILURE path (drifted backend shape → throws), so a future
 *     contract drift trips the suite instead of feeding malformed data into
 *     React state (#17 fake tests: every assertion checks a real behaviour).
 *
 * Backend contract source of truth:
 *   growth-project-backend/src/wearables/samples/dto/sample-response.schema.ts
 */

import {
  wearablesSamplesApi,
  samplesResponseSchema,
  WEARABLE_METRIC_TYPES,
  WEARABLE_METRIC_BUCKETS,
  SAMPLE_FRESHNESS_STATUSES,
  type SamplesResponse,
} from './wearablesSamplesApi';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
});

/** A fully-populated valid samples response matching the backend DTO. */
function validResponse(overrides: Partial<SamplesResponse> = {}): SamplesResponse {
  return {
    version: 1,
    user_id: 'user-1',
    bucket: 'HEALTH_FITNESS',
    window: { from: '2026-05-01T00:00:00.000Z', to: '2026-05-08T00:00:00.000Z' },
    series: [
      {
        metric: 'STEPS',
        unit: 'count',
        provider_used: 'OURA',
        sample_count: 2,
        samples: [
          {
            start_at: '2026-05-01T00:00:00.000Z',
            end_at: '2026-05-01T23:59:59.000Z',
            value: 8421,
            provider: 'OURA',
          },
          {
            start_at: '2026-05-02T00:00:00.000Z',
            end_at: '2026-05-02T23:59:59.000Z',
            value: 10233,
            provider: 'OURA',
          },
        ],
      },
    ],
    freshness: {
      providers: [
        {
          provider: 'OURA',
          last_synced_at: '2026-05-08T06:00:00.000Z',
          status: 'current',
        },
      ],
    },
    ...overrides,
  };
}

describe('wearablesSamplesApi.getSamples', () => {
  it('GETs /v1/wearables/samples with only the required params when optionals omitted', async () => {
    api.get.mockResolvedValueOnce({ data: validResponse() });

    await wearablesSamplesApi.getSamples({
      bucket: 'HEALTH_FITNESS',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
    });

    expect(api.get).toHaveBeenCalledTimes(1);
    const [url, config] = api.get.mock.calls[0];
    expect(url).toBe('/v1/wearables/samples');
    // Optionals must NOT be present as `undefined` — backend uses .strict().
    expect(config.params).toEqual({
      bucket: 'HEALTH_FITNESS',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
    });
    expect('metric' in config.params).toBe(false);
    expect('preferredOnly' in config.params).toBe(false);
  });

  it('stringifies preferredOnly=false to the literal "false" (no implicit truthiness)', async () => {
    api.get.mockResolvedValueOnce({ data: validResponse() });

    await wearablesSamplesApi.getSamples({
      bucket: 'HEALTH_FITNESS',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
      metric: 'STEPS',
      clientId: 'client-uuid-1',
      granularity: 'day',
      preferredOnly: false,
    });

    const [, config] = api.get.mock.calls[0];
    expect(config.params).toEqual({
      bucket: 'HEALTH_FITNESS',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
      metric: 'STEPS',
      clientId: 'client-uuid-1',
      granularity: 'day',
      preferredOnly: 'false',
    });
  });

  it('returns a typed object on a valid backend shape', async () => {
    api.get.mockResolvedValueOnce({ data: validResponse() });

    const result = await wearablesSamplesApi.getSamples({
      bucket: 'HEALTH_FITNESS',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
    });

    expect(result.version).toBe(1);
    expect(result.series[0].metric).toBe('STEPS');
    expect(result.series[0].samples).toHaveLength(2);
    expect(result.freshness.providers[0].status).toBe('current');
  });

  it('parses an empty-window response (null provider_used, empty samples)', async () => {
    api.get.mockResolvedValueOnce({
      data: validResponse({
        series: [
          {
            metric: 'STEPS',
            unit: 'count',
            provider_used: null,
            sample_count: 0,
            samples: [],
          },
        ],
      }),
    });

    const result = await wearablesSamplesApi.getSamples({
      bucket: 'HEALTH_FITNESS',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
    });

    expect(result.series[0].provider_used).toBeNull();
    expect(result.series[0].samples).toHaveLength(0);
  });

  it('parses aggregation buckets when granularity != raw', async () => {
    api.get.mockResolvedValueOnce({
      data: validResponse({
        series: [
          {
            metric: 'STEPS',
            unit: 'count',
            provider_used: 'OURA',
            sample_count: 2,
            samples: [],
            buckets: [
              {
                bucket_start: '2026-05-01T00:00:00.000Z',
                bucket_end: '2026-05-02T00:00:00.000Z',
                agg: 18654,
                count: 2,
              },
            ],
          },
        ],
      }),
    });

    const result = await wearablesSamplesApi.getSamples({
      bucket: 'HEALTH_FITNESS',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-08T00:00:00.000Z',
      granularity: 'day',
    });

    expect(result.series[0].buckets).toHaveLength(1);
    expect(result.series[0].buckets?.[0].agg).toBe(18654);
  });

  it('THROWS (ZodError) when the backend response drifts — unknown bucket', async () => {
    api.get.mockResolvedValueOnce({
      data: { ...validResponse(), bucket: 'NOT_A_BUCKET' },
    });

    await expect(
      wearablesSamplesApi.getSamples({
        bucket: 'HEALTH_FITNESS',
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-05-08T00:00:00.000Z',
      }),
    ).rejects.toThrow();
  });

  it('THROWS when the response carries an unexpected extra key (.strict drift guard)', async () => {
    api.get.mockResolvedValueOnce({
      data: { ...validResponse(), surprise_field: 42 },
    });

    await expect(
      wearablesSamplesApi.getSamples({
        bucket: 'HEALTH_FITNESS',
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-05-08T00:00:00.000Z',
      }),
    ).rejects.toThrow();
  });

  it('THROWS when a sample value is non-finite (corrupt wire data)', async () => {
    // JSON cannot carry NaN, but a corrupt upstream could send a string; the
    // finite() guard ensures a non-number never reaches a chart axis.
    api.get.mockResolvedValueOnce({
      data: validResponse({
        series: [
          {
            metric: 'STEPS',
            unit: 'count',
            provider_used: 'OURA',
            sample_count: 1,
            samples: [
              {
                start_at: '2026-05-01T00:00:00.000Z',
                end_at: '2026-05-01T23:59:59.000Z',
                value: 'oops' as unknown as number,
                provider: 'OURA',
              },
            ],
          },
        ],
      }),
    });

    await expect(
      wearablesSamplesApi.getSamples({
        bucket: 'HEALTH_FITNESS',
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-05-08T00:00:00.000Z',
      }),
    ).rejects.toThrow();
  });
});

describe('wearablesSamplesApi.setPreference', () => {
  it('POSTs /v1/wearables/preferences with snake_case body', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        metric: 'STEPS',
        preferred_provider: 'OURA',
        updated_at: '2026-05-08T06:00:00.000Z',
      },
    });

    const result = await wearablesSamplesApi.setPreference('STEPS', 'OURA');

    expect(api.post).toHaveBeenCalledWith('/v1/wearables/preferences', {
      metric: 'STEPS',
      preferred_provider: 'OURA',
    });
    expect(result.preferred_provider).toBe('OURA');
  });

  it('THROWS when the preference response drifts', async () => {
    api.post.mockResolvedValueOnce({
      data: { metric: 'STEPS', preferred_provider: 'NOPE', updated_at: 'x' },
    });

    await expect(
      wearablesSamplesApi.setPreference('STEPS', 'OURA'),
    ).rejects.toThrow();
  });
});

describe('wearablesSamplesApi.clearPreference', () => {
  it('DELETEs /v1/wearables/preferences/:metric', async () => {
    api.delete.mockResolvedValueOnce({ data: undefined });

    await wearablesSamplesApi.clearPreference('STEPS');

    expect(api.delete).toHaveBeenCalledWith('/v1/wearables/preferences/STEPS');
  });

  it('propagates a 404 (no override existed) rather than swallowing it', async () => {
    const err = Object.assign(new Error('Not Found'), {
      response: { status: 404 },
    });
    api.delete.mockRejectedValueOnce(err);

    await expect(wearablesSamplesApi.clearPreference('STEPS')).rejects.toBe(err);
  });
});

describe('canonical enum coverage', () => {
  it('exposes both metric buckets', () => {
    expect(WEARABLE_METRIC_BUCKETS).toEqual(['HEALTH_FITNESS', 'SLEEP_RECOVERY']);
  });

  it('exposes the full freshness status set', () => {
    expect(SAMPLE_FRESHNESS_STATUSES).toEqual([
      'current',
      'needs_attention',
      'never_synced',
    ]);
  });

  it('the response schema accepts every declared metric type', () => {
    for (const metric of WEARABLE_METRIC_TYPES) {
      const parsed = samplesResponseSchema.safeParse(
        validResponse({
          series: [
            {
              metric,
              unit: 'unit',
              provider_used: null,
              sample_count: 0,
              samples: [],
            },
          ],
        }),
      );
      expect(parsed.success).toBe(true);
    }
  });
});
