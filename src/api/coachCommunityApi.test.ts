/**
 * coachCommunityApi — wire-contract tests for the v1-6 coach surface.
 *
 * Mocks the axios instance at `../services/api` (the repo's established test
 * seam) and asserts, for the endpoints:
 *   - the exact URL + HTTP method the mobile client sends,
 *   - that NO `coachId` is ever threaded into a URL or payload (hard gate:
 *     the acting coach is derived from the JWT, never a client-supplied param),
 *   - a Zod parse-SUCCESS path (valid backend shape -> typed object),
 *   - a Zod parse-FAILURE path (drifted shape -> CoachCommunityApiError contract),
 *   - HTTP error mapping (401 -> unauthorized, 403 -> forbidden, 5xx -> server),
 *   - that mutations send an Idempotency-Key header (R19).
 */
import {
  coachCommunityApi,
  CoachCommunityApiError,
  CoachEmptyStatesResponseSchema,
  RomanCopyPayloadSchema,
  COACH_EMPTY_STATE_SURFACE_KEYS,
  AckStateSchema,
  CoachSlaSnapshotSchema,
  AckTransitionResponseSchema,
  type CoachDashboard,
  type CoachEmptyStatesResponse,
} from './coachCommunityApi';
import { getCoachEmptyStateFallback } from '../components/community/coach/coachVoice';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// The idempotency util reads crypto.getRandomValues; provide a deterministic
// stub so the mutation tests do not depend on the RN polyfill.
jest.mock('../utils/idempotency', () => ({
  generateIdempotencyKey: () => 'test-idempotency-key',
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

function axiosError(status: number): Error {
  const err = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

const validDashboard: CoachDashboard = {
  unread_inbox_count: 3,
  active_cohort_count: 2,
  flagged_today_count: 1,
};

describe('coachCommunityApi — read endpoints', () => {
  it('getDashboard hits the dashboard endpoint and parses the envelope', async () => {
    api.get.mockResolvedValueOnce({ data: validDashboard });
    const res = await coachCommunityApi.getDashboard();
    expect(api.get).toHaveBeenCalledWith('/community/coach/dashboard');
    expect(res.unread_inbox_count).toBe(3);
  });

  it('getInbox forwards keyset params', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [], next_before: null } });
    await coachCommunityApi.getInbox({ before: 'cursor-1', limit: 20 });
    expect(api.get).toHaveBeenCalledWith('/community/coach/inbox', {
      params: { before: 'cursor-1', limit: '20' },
    });
  });

  it('getCohorts unwraps the cohorts array', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        cohorts: [
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            name: 'Spring',
            member_count: 4,
            unread_count: 0,
            created_at: '2026-06-10T00:00:00.000Z',
          },
        ],
      },
    });
    const res = await coachCommunityApi.getCohorts();
    expect(api.get).toHaveBeenCalledWith('/community/coach/cohorts');
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('Spring');
  });

  it('getCohortDetail hits the by-id endpoint', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        cohort: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          name: 'Spring',
          member_count: 0,
          unread_count: 0,
          created_at: '2026-06-10T00:00:00.000Z',
        },
        members: [],
      },
    });
    await coachCommunityApi.getCohortDetail('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(api.get).toHaveBeenCalledWith(
      '/community/coach/cohorts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
  });

  it('getFlagged unwraps the items array', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [] } });
    const res = await coachCommunityApi.getFlagged();
    expect(api.get).toHaveBeenCalledWith('/community/moderation/flagged');
    expect(res).toEqual([]);
  });
});

describe('coachCommunityApi — mutations carry Idempotency-Key + no coachId', () => {
  it('ackInboxItem posts to the ack endpoint with an idempotency header', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.ackInboxItem('11111111-1111-1111-1111-111111111111');
    expect(api.post).toHaveBeenCalledWith(
      '/community/coach/inbox/11111111-1111-1111-1111-111111111111/ack',
      {},
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });

  it('createCohort posts the name with an idempotency header (no coachId)', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        cohort: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          name: 'Winter',
          member_count: 0,
          unread_count: 0,
          created_at: '2026-06-10T00:00:00.000Z',
        },
      },
    });
    await coachCommunityApi.createCohort({ name: 'Winter' });
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/community/coach/cohorts');
    expect(body).toEqual({ name: 'Winter' });
    // The payload must NOT contain a coachId — the JWT is the only authority.
    expect(JSON.stringify(body)).not.toMatch(/coachId/i);
  });

  it('inviteMember posts the email to the members endpoint', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        member: {
          user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          name: 'Dana',
          email: 'dana@example.com',
          avatar_url: null,
          role: 'client',
          joined_at: '2026-06-10T00:00:00.000Z',
        },
      },
    });
    await coachCommunityApi.inviteMember('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', {
      email: 'dana@example.com',
    });
    expect(api.post).toHaveBeenCalledWith(
      '/community/coach/cohorts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/members',
      { email: 'dana@example.com' },
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });

  it('removeMember deletes the member by userId', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.removeMember(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
    expect(api.delete).toHaveBeenCalledWith(
      '/community/coach/cohorts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/members/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
  });

  it('hidePost posts to the post hide endpoint', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.hidePost('dddddddd-dddd-dddd-dddd-dddddddddddd');
    expect(api.post).toHaveBeenCalledWith(
      '/community/posts/dddddddd-dddd-dddd-dddd-dddddddddddd/hide',
      {},
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });

  it('hideMessage posts to the message hide endpoint', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.hideMessage('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(api.post).toHaveBeenCalledWith(
      '/community/messages/ffffffff-ffff-ffff-ffff-ffffffffffff/hide',
      {},
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });
});

describe('coachCommunityApi — empty-states payload contract (face + voice)', () => {
  /** A complete, well-formed wire response covering all five surfaces. */
  function validEmptyStatesWire(): Record<string, unknown> {
    const wire: Record<string, unknown> = {};
    for (const key of COACH_EMPTY_STATE_SURFACE_KEYS) {
      wire[key] = {
        text: `Roman copy for ${key}`,
        avatar_crop: key === 'coach_community_moderation_empty' ? 'smile' : 'neutral',
        surface_key: key,
        voice_variant: 'roman_v2',
      };
    }
    return wire;
  }

  it('getCoachEmptyStates hits the coach empty-states endpoint and parses every surface', async () => {
    api.get.mockResolvedValueOnce({ data: validEmptyStatesWire() });
    const res = await coachCommunityApi.getCoachEmptyStates();
    expect(api.get).toHaveBeenCalledWith('/community/coach/empty-states');
    // Every contract surface is present and typed.
    for (const key of COACH_EMPTY_STATE_SURFACE_KEYS) {
      expect(res[key]).toBeDefined();
      expect(res[key]?.surface_key).toBe(key);
      expect(res[key]?.voice_variant).toBe('roman_v2');
    }
    expect(res.coach_community_moderation_empty?.avatar_crop).toBe('smile');
  });

  it('parses a single payload through RomanCopyPayloadSchema with the four contract fields', () => {
    const parsed = RomanCopyPayloadSchema.parse({
      text: 'Quiet morning.',
      avatar_crop: 'neutral',
      surface_key: 'coach_community_home_empty',
      voice_variant: 'roman_v2',
      // An additive backend field must not fail the boundary parse (passthrough).
      avatar_url: 'https://cdn.example.com/roman/neutral.png',
    });
    expect(parsed.text).toBe('Quiet morning.');
    expect(parsed.avatar_crop).toBe('neutral');
    expect(parsed.surface_key).toBe('coach_community_home_empty');
    expect(parsed.voice_variant).toBe('roman_v2');
  });

  it('rejects a payload missing a contract field (drifted shape)', () => {
    expect(() =>
      RomanCopyPayloadSchema.parse({
        text: 'Missing crop + variant',
        surface_key: 'coach_community_home_empty',
      }),
    ).toThrow();
  });

  it('CoachEmptyStatesResponseSchema accepts the full five-surface wire shape', () => {
    const parsed: CoachEmptyStatesResponse = CoachEmptyStatesResponseSchema.parse(
      validEmptyStatesWire(),
    );
    expect(Object.keys(parsed).sort()).toEqual(
      [...COACH_EMPTY_STATE_SURFACE_KEYS].sort(),
    );
  });

  it('NEGATIVE — a 200 missing a surface key is detected by the screen-hook invariant', async () => {
    // The API client itself records whatever surfaces the server returns; the
    // contract floor (every required surface present) is enforced in
    // useCoachEmptyStates. Here we prove the building blocks the invariant uses:
    // a wire response missing `coach_community_inbox_empty` parses into a record
    // WITHOUT that key, so the hook's `data[key] == null` check fires a
    // `contract` error rather than silently falling back to constants.
    const wire = validEmptyStatesWire();
    delete wire.coach_community_inbox_empty;
    api.get.mockResolvedValueOnce({ data: wire });
    const res = await coachCommunityApi.getCoachEmptyStates();
    expect(res.coach_community_inbox_empty).toBeUndefined();
    // Mirror the invariant in useCoachEmptyStates to assert it WOULD throw.
    const missing = COACH_EMPTY_STATE_SURFACE_KEYS.filter((k) => res[k] == null);
    expect(missing).toEqual(['coach_community_inbox_empty']);
  });

  it('FALLBACK — getCoachEmptyStateFallback returns a legacy-stamped payload (error path only)', () => {
    for (const key of COACH_EMPTY_STATE_SURFACE_KEYS) {
      const fallback = getCoachEmptyStateFallback(key);
      // A fully-typed RomanCopyPayload, so the screen can render it unchanged.
      expect(() => RomanCopyPayloadSchema.parse(fallback)).not.toThrow();
      expect(fallback.surface_key).toBe(key);
      // Stamped 'legacy' so analytics can tell a fallback render from a live one.
      expect(fallback.voice_variant).toBe('legacy');
      expect(fallback.text.length).toBeGreaterThan(0);
    }
    // The celebratory surface keeps its smile crop even in the fallback.
    expect(
      getCoachEmptyStateFallback('coach_community_moderation_empty').avatar_crop,
    ).toBe('smile');
  });
});

describe('coachCommunityApi — post-detail composition', () => {
  it('getCoachPostDetail composes the post + comments reads and parses both', async () => {
    api.get
      .mockResolvedValueOnce({
        data: {
          post: {
            id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            workspace_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            cohort_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            author_user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            title: 'Form check',
            body: 'Filming today.',
            scope: 'cohort',
            type: 'text',
            pinned: false,
            created_at: '2026-06-10T00:00:00.000Z',
            updated_at: '2026-06-10T00:00:00.000Z',
            deleted: false,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          comments: [
            {
              id: 'aaaa1111-aaaa-1111-aaaa-111111111111',
              // The backend comment view may emit an empty post_id by design.
              post_id: '',
              author_user_id: 'cccc2222-cccc-2222-cccc-222222222222',
              body: 'Drive the knees out.',
              created_at: '2026-06-10T00:30:00.000Z',
            },
          ],
        },
      });
    const res = await coachCommunityApi.getCoachPostDetail(
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
    );
    expect(api.get).toHaveBeenNthCalledWith(
      1,
      '/community/posts/dddddddd-dddd-dddd-dddd-dddddddddddd',
    );
    expect(api.get).toHaveBeenNthCalledWith(
      2,
      '/community/posts/dddddddd-dddd-dddd-dddd-dddddddddddd/comments',
    );
    expect(res.post.title).toBe('Form check');
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0].post_id).toBe('');
  });
});

describe('coachCommunityApi — error + contract mapping', () => {
  it('maps 401 to an unauthorized CoachCommunityApiError', async () => {
    api.get.mockRejectedValueOnce(axiosError(401));
    await expect(coachCommunityApi.getDashboard()).rejects.toMatchObject({
      name: 'CoachCommunityApiError',
      kind: 'unauthorized',
      status: 401,
    });
  });

  it('maps 403 to a forbidden CoachCommunityApiError', async () => {
    api.get.mockRejectedValueOnce(axiosError(403));
    await expect(coachCommunityApi.getCohorts()).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });
  });

  it('maps 500 to a server CoachCommunityApiError', async () => {
    api.get.mockRejectedValueOnce(axiosError(500));
    await expect(coachCommunityApi.getFlagged()).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('throws a contract error when the dashboard shape drifts', async () => {
    api.get.mockResolvedValueOnce({ data: { unread_inbox_count: 'three' } });
    const err = await coachCommunityApi.getDashboard().catch((e) => e);
    expect(err).toBeInstanceOf(CoachCommunityApiError);
    expect(err.kind).toBe('contract');
  });
});

// ─── v2-2 ack DTO strict drift contract (mirrors backend ack.dto.ts) ─────────
//
// These prove the mobile ack schemas mirror the backend Zod DTOs on
// `feat/community-v2-2-ack-backend` (saved copy: v2_2_backend_r2_ack.dto.ts)
// EXACTLY, including `.strict()` on every object level, the UUID `message_id`,
// and the `z.string().datetime().nullable()` timestamps. The backend fields
// mirrored here are:
//   - SlaSnapshotSchema (ack.dto.ts:45-52): `sla_state` (within|warning|
//     breached), `elapsed_ms`, `soft_target_ms`, `hard_target_ms`, `.strict()`.
//   - AckStateSchema (ack.dto.ts:62-70): `state` (none|seen|acked|replied),
//     `seen_at`/`acked_at`/`replied_at` (datetime string | null), nested `sla`,
//     `.strict()`.
//   - AckTransitionResponseSchema (ack.dto.ts:75-80): `message_id` (UUID),
//     `ack` (AckStateSchema), `.strict()`.
// No fields are invented beyond those declared in the backend DTO.
describe('coachCommunityApi — v2-2 ack DTO strict drift contract', () => {
  const MSG_ID = '11111111-1111-1111-1111-111111111111';

  /** A well-formed SLA snapshot mirroring backend SlaSnapshotSchema. */
  const validSla = () => ({
    sla_state: 'within' as const,
    elapsed_ms: 1_000,
    soft_target_ms: 24 * 60 * 60 * 1000,
    hard_target_ms: 48 * 60 * 60 * 1000,
  });

  /** A well-formed ack envelope mirroring backend AckStateSchema. */
  const validAck = () => ({
    state: 'acked' as const,
    seen_at: '2026-06-09T12:00:00.000Z',
    acked_at: '2026-06-09T12:05:00.000Z',
    replied_at: null,
    sla: validSla(),
  });

  /** A well-formed transition envelope mirroring AckTransitionResponseSchema. */
  const validTransition = () => ({
    message_id: MSG_ID,
    ack: validAck(),
  });

  it('parses a valid transition envelope into the typed shape', () => {
    const parsed = AckTransitionResponseSchema.parse(validTransition());
    expect(parsed.message_id).toBe(MSG_ID);
    expect(parsed.ack.state).toBe('acked');
    expect(parsed.ack.seen_at).toBe('2026-06-09T12:00:00.000Z');
    expect(parsed.ack.replied_at).toBeNull();
    expect(parsed.ack.sla.sla_state).toBe('within');
  });

  it('parses an envelope with all-null timestamps (untouched message)', () => {
    const parsed = AckStateSchema.parse({
      state: 'none',
      seen_at: null,
      acked_at: null,
      replied_at: null,
      sla: validSla(),
    });
    expect(parsed.state).toBe('none');
    expect(parsed.seen_at).toBeNull();
  });

  it('rejects an extra field at the transition-response level (.strict())', () => {
    expect(() =>
      AckTransitionResponseSchema.parse({
        ...validTransition(),
        // Backend AckTransitionResponseSchema is `.strict()`; an undeclared
        // field must fail rather than silently pass through.
        unexpected: 'drift',
      }),
    ).toThrow();
  });

  it('rejects an extra field at the ack-state level (.strict())', () => {
    expect(() =>
      AckStateSchema.parse({
        ...validAck(),
        // Not a declared AckStateSchema field.
        coach_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      }),
    ).toThrow();
  });

  it('rejects an extra field at the SLA-snapshot level (.strict())', () => {
    expect(() =>
      CoachSlaSnapshotSchema.parse({
        ...validSla(),
        // Not a declared SlaSnapshotSchema field.
        warning_target_ms: 12 * 60 * 60 * 1000,
      }),
    ).toThrow();
  });

  it('rejects a malformed seen_at datetime string', () => {
    expect(() =>
      AckStateSchema.parse({ ...validAck(), seen_at: 'not-a-datetime' }),
    ).toThrow();
  });

  it('rejects a malformed acked_at datetime string', () => {
    expect(() =>
      AckStateSchema.parse({ ...validAck(), acked_at: '2026-06-09 12:05:00' }),
    ).toThrow();
  });

  it('rejects a malformed replied_at datetime string', () => {
    expect(() =>
      AckStateSchema.parse({
        ...validAck(),
        state: 'replied',
        replied_at: '06/09/2026',
      }),
    ).toThrow();
  });

  it('rejects a non-UUID message_id at the transition-response level', () => {
    expect(() =>
      AckTransitionResponseSchema.parse({
        ...validTransition(),
        message_id: 'not-a-uuid',
      }),
    ).toThrow();
  });
});
