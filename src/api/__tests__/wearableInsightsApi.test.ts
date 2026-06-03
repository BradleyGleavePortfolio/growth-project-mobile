/**
 * wearableInsightsApi — wire-contract tests (PR-HK-5a).
 *
 * Mocks the axios instance at `../../services/api` (the repo's established test
 * seam — see wearablesSamplesApi.test.ts) and asserts, for every endpoint:
 *   • the exact URL + method + params/payload mobile sends,
 *   • a Zod parse-SUCCESS path (valid backend shape → typed object),
 *   • a Zod parse-FAILURE path (missing field / extra field → throws under
 *     `.strict()`), so a future contract drift trips the suite (#17),
 *   • the approve 404 → propagated to the caller (never coerced to a fake
 *     degraded success that would hide a deploy/route regression, #36),
 *   • the approve 500 → re-throw (never silently masked, #36).
 *
 * Backend contract source of truth:
 *   growth-project-backend/src/wearables/insights/insight-output.schema.ts
 *   growth-project-backend/src/wearables/insights/wearable-insights.controller.ts
 */

import { AxiosError, AxiosHeaders } from 'axios';
import {
  fetchCoachInsight,
  approveDraft,
  CoachInsightResponseSchema,
  CoachInsightSchema,
  EmptyInsightSchema,
  EMPTY_OBSERVATION,
  type CoachInsight,
  type EmptyInsight,
} from '../wearableInsightsApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

function validCoachInsight(overrides: Partial<CoachInsight> = {}): CoachInsight {
  return {
    observation: 'Deep sleep down 40% vs baseline this week',
    hypothesis: 'Possibly light exposure or late caffeine',
    suggested_action: 'Ask about evening routine changes',
    suggested_message_draft:
      'Hey, noticed your deep sleep dipped — anything change in your evenings?',
    confidence_level: 'fairly_sure',
    source_metrics: ['SLEEP_DEEP_MIN', 'HRV_MS'],
    ...overrides,
  };
}

function validEmptyInsight(): EmptyInsight {
  return {
    observation: EMPTY_OBSERVATION,
    confidence_level: 'i_think',
    source_metrics: [],
    is_empty: true,
  };
}

/** Build an AxiosError carrying a given HTTP status (mirrors the api seam). */
function axiosErrorWithStatus(status: number): AxiosError {
  const err = new AxiosError('Request failed', 'ERR_BAD_RESPONSE');
  err.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

describe('fetchCoachInsight', () => {
  it('sends clientId + bucket and returns a parsed full CoachInsight (happy path)', async () => {
    const payload = validCoachInsight();
    api.get.mockResolvedValueOnce({ data: payload });

    const result = await fetchCoachInsight({
      clientId: 'client-123',
      bucket: 'SLEEP_RECOVERY',
    });

    expect(api.get).toHaveBeenCalledWith('/v1/wearables/insights/coach', {
      params: { clientId: 'client-123', bucket: 'SLEEP_RECOVERY' },
    });
    expect(result).toEqual(payload);
    // Discriminant: a full insight is NOT the empty branch.
    expect('is_empty' in result).toBe(false);
  });

  it('returns the parsed EmptyInsight on the empty branch', async () => {
    const payload = validEmptyInsight();
    api.get.mockResolvedValueOnce({ data: payload });

    const result = await fetchCoachInsight({
      clientId: 'client-123',
      bucket: 'HEALTH_FITNESS',
    });

    expect(result).toEqual(payload);
    expect((result as EmptyInsight).is_empty).toBe(true);
  });

  it('propagates a 403 (forbidden) error — never swallowed', async () => {
    api.get.mockRejectedValueOnce(axiosErrorWithStatus(403));
    await expect(
      fetchCoachInsight({ clientId: 'c', bucket: 'HEALTH_FITNESS' }),
    ).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 500 (server) error — never swallowed', async () => {
    api.get.mockRejectedValueOnce(axiosErrorWithStatus(500));
    await expect(
      fetchCoachInsight({ clientId: 'c', bucket: 'HEALTH_FITNESS' }),
    ).rejects.toBeInstanceOf(AxiosError);
  });

  it('throws (Zod) when a required field is missing', async () => {
    const { hypothesis: _omit, ...missing } = validCoachInsight();
    api.get.mockResolvedValueOnce({ data: missing });
    await expect(
      fetchCoachInsight({ clientId: 'c', bucket: 'SLEEP_RECOVERY' }),
    ).rejects.toThrow();
  });

  it('throws (Zod .strict()) when an unknown extra field is present', async () => {
    api.get.mockResolvedValueOnce({
      data: { ...validCoachInsight(), smuggled: 'client-only-field' },
    });
    await expect(
      fetchCoachInsight({ clientId: 'c', bucket: 'SLEEP_RECOVERY' }),
    ).rejects.toThrow();
  });
});

describe('approveDraft', () => {
  it('posts the snake_case body and returns ok on success', async () => {
    const ok = {
      status: 'ok' as const,
      draft_id: '11111111-1111-1111-1111-111111111111',
      materialised_at: '2026-05-20T10:00:00Z',
    };
    api.post.mockResolvedValueOnce({ data: ok });

    const res = await approveDraft({
      clientId: 'client-9',
      bucket: 'HEALTH_FITNESS',
      draftBody: 'Hello there',
      action: 'approve',
    });

    expect(api.post).toHaveBeenCalledWith('/v1/wearables/insights/approve', {
      client_id: 'client-9',
      bucket: 'HEALTH_FITNESS',
      draft_body: 'Hello there',
      action: 'approve',
    });
    expect(res).toEqual(ok);
  });

  it('propagates a 404 to the caller — the HK-6a route is live, so a 404 is a real regression, never coerced to a fake success (#36)', async () => {
    api.post.mockRejectedValueOnce(axiosErrorWithStatus(404));

    await expect(
      approveDraft({
        clientId: 'client-9',
        bucket: 'SLEEP_RECOVERY',
        draftBody: 'Hi',
        action: 'approve',
      }),
    ).rejects.toBeInstanceOf(AxiosError);
  });

  it('re-throws a 500 — the failure is never masked', async () => {
    api.post.mockRejectedValueOnce(axiosErrorWithStatus(500));
    await expect(
      approveDraft({
        clientId: 'c',
        bucket: 'HEALTH_FITNESS',
        draftBody: 'x',
        action: 'approve',
      }),
    ).rejects.toBeInstanceOf(AxiosError);
  });

  it('throws (Zod) when a 200 response is shaped wrong', async () => {
    api.post.mockResolvedValueOnce({
      data: { status: 'ok', draft_id: 'not-a-uuid', materialised_at: 1 },
    });
    await expect(
      approveDraft({
        clientId: 'c',
        bucket: 'HEALTH_FITNESS',
        draftBody: 'x',
        action: 'approve',
      }),
    ).rejects.toThrow();
  });
});

describe('schema parity with the backend contract', () => {
  it('CoachInsightResponseSchema accepts both branches of the union', () => {
    expect(CoachInsightResponseSchema.parse(validCoachInsight())).toBeTruthy();
    expect(CoachInsightResponseSchema.parse(validEmptyInsight())).toBeTruthy();
  });

  it('CoachInsightSchema enforces the 280-char observation cap', () => {
    const tooLong = validCoachInsight({ observation: 'a'.repeat(281) });
    expect(() => CoachInsightSchema.parse(tooLong)).toThrow();
  });

  it('EmptyInsightSchema rejects a non-empty source_metrics array', () => {
    expect(() =>
      EmptyInsightSchema.parse({
        ...validEmptyInsight(),
        source_metrics: ['STEPS'],
      }),
    ).toThrow();
  });
});
