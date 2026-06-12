/**
 * communityAiTriageApi — wire-contract tests (v2-4).
 *
 * Mocks the axios instance at `../../services/api` (the repo's established test
 * seam) and asserts:
 *   • the exact URL + method mobile sends for the triage read,
 *   • a Zod parse-SUCCESS path (valid backend shape → typed object),
 *   • Zod parse-FAILURE paths under `.strict()` so a future backend drift trips
 *     the suite: an extra top-level key, a sixth category, a non-uuid source
 *     id, a non-datetime generated_at, and the wrong bucket count,
 *   • a 404 (server kill-switch off) and a 500 both PROPAGATE to the caller
 *     (never coerced into a fake "all clear" — #36 silent failure).
 *
 * Backend contract source of truth:
 *   growth-project-backend/src/community/ai-triage/triage-output.schema.ts
 *   growth-project-backend/src/community/ai-triage/ai-triage.controller.ts
 */

import { AxiosError, AxiosHeaders } from 'axios';
import {
  fetchInboxTriage,
  TriageResponseSchema,
  TRIAGE_CATEGORIES,
  type TriageResponse,
} from '../communityAiTriageApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
});

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function validTriage(overrides: Partial<TriageResponse> = {}): TriageResponse {
  const buckets = TRIAGE_CATEGORIES.map((category) => {
    if (category === 'urgent') {
      return {
        category,
        items: [
          {
            source_item_id: ID_A,
            source_kind: 'message' as const,
            category,
            summary: 'Client is asking when their next check-in call is.',
          },
        ],
      };
    }
    if (category === 'win_to_celebrate') {
      return {
        category,
        items: [
          {
            source_item_id: ID_B,
            source_kind: 'post' as const,
            category,
            summary: 'Client hit a new squat personal best this week.',
          },
        ],
      };
    }
    return { category, items: [] };
  });
  return {
    generated_at: new Date('2026-06-10T12:00:00Z').toISOString(),
    is_empty: false,
    buckets,
    source_item_ids: [ID_A, ID_B],
    ...overrides,
  };
}

function axiosError(status: number): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    {
      status,
      statusText: String(status),
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    },
  );
}

describe('communityAiTriageApi.fetchInboxTriage', () => {
  it('GETs /community/ai-triage and returns the parsed typed triage', async () => {
    api.get.mockResolvedValue({ data: validTriage() });

    const out = await fetchInboxTriage();

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls[0][0]).toBe('/community/ai-triage');
    expect(out.buckets).toHaveLength(TRIAGE_CATEGORIES.length);
    expect(out.source_item_ids).toEqual([ID_A, ID_B]);
    expect(out.is_empty).toBe(false);
  });

  it('parses an honest empty triage', async () => {
    const empty: TriageResponse = {
      generated_at: new Date().toISOString(),
      is_empty: true,
      buckets: TRIAGE_CATEGORIES.map((category) => ({ category, items: [] })),
      source_item_ids: [],
    };
    api.get.mockResolvedValue({ data: empty });

    const out = await fetchInboxTriage();
    expect(out.is_empty).toBe(true);
    expect(out.source_item_ids).toEqual([]);
  });
});

describe('communityAiTriageApi — Zod drift guards (.strict())', () => {
  it('rejects an extra top-level key', () => {
    const drifted = { ...validTriage(), injected_command: 'send_all' };
    expect(() => TriageResponseSchema.parse(drifted)).toThrow();
  });

  it('rejects a sixth / unknown category in a bucket', () => {
    const base = validTriage();
    const drifted = {
      ...base,
      buckets: [...base.buckets, { category: 'spam', items: [] }],
    };
    expect(() => TriageResponseSchema.parse(drifted)).toThrow();
  });

  it('rejects the wrong bucket count (must be exactly five)', () => {
    const base = validTriage();
    const drifted = { ...base, buckets: base.buckets.slice(0, 4) };
    expect(() => TriageResponseSchema.parse(drifted)).toThrow();
  });

  it('rejects a non-uuid source_item_id', () => {
    const drifted = {
      ...validTriage(),
      source_item_ids: ['not-a-uuid'],
    };
    expect(() => TriageResponseSchema.parse(drifted)).toThrow();
  });

  it('rejects a non-datetime generated_at', () => {
    const drifted = { ...validTriage(), generated_at: 'yesterday' };
    expect(() => TriageResponseSchema.parse(drifted)).toThrow();
  });

  it('rejects an item smuggling an extra (draft_reply) field', () => {
    const base = validTriage();
    const buckets = base.buckets.map((b) =>
      b.category === 'urgent'
        ? {
            ...b,
            items: [{ ...b.items[0], draft_reply: 'You should do X.' }],
          }
        : b,
    );
    expect(() => TriageResponseSchema.parse({ ...base, buckets })).toThrow();
  });
});

describe('communityAiTriageApi — failures propagate (no silent fallback)', () => {
  it('propagates a 404 (server kill-switch off) to the caller', async () => {
    api.get.mockRejectedValue(axiosError(404));
    await expect(fetchInboxTriage()).rejects.toBeInstanceOf(AxiosError);
  });

  it('propagates a 500 to the caller', async () => {
    api.get.mockRejectedValue(axiosError(500));
    await expect(fetchInboxTriage()).rejects.toBeInstanceOf(AxiosError);
  });

  it('throws (never returns) on a Zod-drifted response', async () => {
    api.get.mockResolvedValue({ data: { ...validTriage(), extra: true } });
    await expect(fetchInboxTriage()).rejects.toThrow();
  });
});
