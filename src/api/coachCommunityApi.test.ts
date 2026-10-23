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
  type CoachEmptyStatesResponse,
} from './coachCommunityApi';
import { getCoachEmptyStateFallback } from '../components/community/coach/coachVoice';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
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
  patch: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
});

function axiosError(status: number, data?: unknown): Error {
  const err = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data?: unknown };
  };
  err.isAxiosError = true;
  err.response = { status, data };
  return err;
}

// ─── Server shapes, copied from growth-project-backend main 7359c3f9 ─────────

const COHORT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IDEM = { headers: { 'Idempotency-Key': 'test-idempotency-key' } };

/** src/community/dto/community-cohort.dto.ts:16-28 (one row of :30-35). */
const serverCohortSummary = {
  id: COHORT_ID,
  workspace_id: WORKSPACE_ID,
  name: 'Spring',
  is_default: false,
  kind: 'chat',
  posting_policy: 'all',
  visibility: 'clients',
  member_count: 4,
  my_role: 'coach',
};

/** src/community/inbox/community-coach-inbox.dto.ts:34-49. */
function serverInboxRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'message',
    cohort_id: COHORT_ID,
    cohort_name: 'Spring',
    author_user_id: USER_ID,
    author_display_name: 'Dana Reyes',
    preview: 'Can I swap Thursday for Friday?',
    created_at: '2026-10-21T09:00:00.000Z',
    item_url_path: `/community/cohorts/${COHORT_ID}/messages/${id}`,
    ...extra,
  };
}

/** src/community/cohorts/community-cohort-members.dto.ts:60-81. */
function serverMember(extra: Record<string, unknown> = {}) {
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    user_id: USER_ID,
    display_name: 'Dana Reyes',
    role: 'student',
    status: 'active',
    email: 'dana@example.com',
    joined_at: '2026-10-01T00:00:00.000Z',
    access: { reason: 'client', package_id: null, until: null },
    ...extra,
  };
}

/** A flagged-queue row (the shape getFlagged already parses). */
function flagged(id: string, created_at: string) {
  return {
    id,
    target_type: 'post',
    target_id: id,
    content: 'Buy followers here',
    author_name: 'Dana Reyes',
    cohort_name: 'Spring',
    reason: 'spam',
    created_at,
  };
}

/** Answer api.get by URL, like the server would. */
function serveGets(routes: Record<string, unknown>): void {
  api.get.mockImplementation((url: string) =>
    url in routes
      ? routes[url] instanceof Error
        ? Promise.reject(routes[url])
        : Promise.resolve({ data: routes[url] })
      : Promise.reject(axiosError(404)),
  );
}

const ROW_1 = '11111111-1111-4111-8111-111111111111';
const ROW_2 = '22222222-2222-4222-8222-222222222222';

describe('coachCommunityApi — read endpoints on the server routes', () => {
  it('getCohorts reads GET /community/cohorts (community.controller.ts:71)', async () => {
    serveGets({
      '/community/cohorts': {
        feature_flag_state: 'enabled',
        cohorts: [serverCohortSummary],
      },
    });
    const res = await coachCommunityApi.getCohorts();
    expect(api.get).toHaveBeenCalledWith('/community/cohorts');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      id: COHORT_ID,
      name: 'Spring',
      member_count: 4,
      unread_count: 0,
    });
  });

  it('getCohorts: a coach with no spaces yet is set up by GET /community/me, then read again', async () => {
    const lists = [[], [serverCohortSummary]];
    api.get.mockImplementation((url: string) => Promise.resolve({
      data: url === '/community/me' ? { workspace_id: WORKSPACE_ID } : { cohorts: lists.shift() ?? [] },
    }));
    const res = await coachCommunityApi.getCohorts();
    const urls = api.get.mock.calls.map((c: unknown[]) => c[0]);
    expect(urls).toEqual(['/community/cohorts', '/community/me', '/community/cohorts']);
    expect(res.map((c) => c.name)).toEqual(['Spring']);
  });

  it('getInbox reads GET /community/me/coach-inbox and maps the row (community-coach-inbox.controller.ts:25)', async () => {
    const ack = { state: 'seen', sla_state: 'within' };
    serveGets({
      '/community/me/coach-inbox': {
        items: [serverInboxRow(ROW_1, { ack })],
        next_cursor: 'cursor-2',
      },
    });
    const res = await coachCommunityApi.getInbox({ cursor: 'cursor-1' });
    expect(api.get).toHaveBeenCalledWith('/community/me/coach-inbox', {
      params: { limit: '100', cursor: 'cursor-1' },
    });
    expect(res.next_cursor).toBe('cursor-2');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: ROW_1,
      cohort_id: COHORT_ID,
      cohort_name: 'Spring',
      client_user_id: USER_ID,
      client_name: 'Dana Reyes',
      avatar_url: null,
      snippet: 'Can I swap Thursday for Friday?',
      created_at: '2026-10-21T09:00:00.000Z',
      acknowledged: false,
      type: 'message',
      kind: 'text',
      ack,
    });
  });

  it('getInbox skips a row kind it does not know and never throws', async () => {
    serveGets({
      '/community/me/coach-inbox': {
        items: [
          serverInboxRow(ROW_1),
          serverInboxRow(ROW_2, { kind: 'voice', voice: { duration_ms: 4000 } }),
          { ...serverInboxRow(ROW_2), type: 'event' },
          { nonsense: true },
        ],
        next_cursor: null,
      },
    });
    const res = await coachCommunityApi.getInbox();
    expect(res.items.map((i) => i.id)).toEqual([ROW_1]);
  });

  it('getInbox: an empty inbox, and a coach with no cohorts (403 community.inbox.not_coach), are both empty', async () => {
    serveGets({ '/community/me/coach-inbox': { items: [], next_cursor: null } });
    await expect(coachCommunityApi.getInbox()).resolves.toEqual({
      items: [],
      next_cursor: null,
    });
    // community-coach-inbox.service.ts:24-27 is the 403 body.
    serveGets({
      '/community/me/coach-inbox': axiosError(403, {
        error: 'forbidden',
        code: 'community.inbox.not_coach',
      }),
    });
    await expect(coachCommunityApi.getInbox()).resolves.toEqual({
      items: [],
      next_cursor: null,
    });
  });

  it('getInbox: any other failure is an error, not an empty inbox', async () => {
    serveGets({ '/community/me/coach-inbox': axiosError(403) });
    await expect(coachCommunityApi.getInbox()).rejects.toMatchObject({
      kind: 'forbidden',
    });
    serveGets({ '/community/me/coach-inbox': axiosError(500) });
    await expect(coachCommunityApi.getInbox()).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('getDashboard is built from cohorts + inbox + flagged (no dashboard route)', async () => {
    const today = new Date().toISOString();
    serveGets({
      '/community/cohorts': {
        feature_flag_state: 'enabled',
        cohorts: [serverCohortSummary, { ...serverCohortSummary, id: WORKSPACE_ID }],
      },
      '/community/me/coach-inbox': {
        items: [serverInboxRow(ROW_1), serverInboxRow(ROW_2)],
        next_cursor: null,
      },
      '/community/moderation/flagged': {
        items: [flagged(ROW_1, today), flagged(ROW_2, '2020-01-01T12:00:00.000Z')],
      },
    });
    const res = await coachCommunityApi.getDashboard();
    expect(res).toEqual({
      unread_inbox_count: 2,
      active_cohort_count: 2,
      flagged_today_count: 1,
    });
    const urls = api.get.mock.calls.map((c) => c[0]);
    expect(urls.sort()).toEqual([
      '/community/cohorts',
      '/community/me/coach-inbox',
      '/community/moderation/flagged',
    ]);
  });

  it('getDashboard fails when one of its reads fails', async () => {
    serveGets({
      '/community/cohorts': axiosError(500),
      '/community/me/coach-inbox': { items: [], next_cursor: null },
      '/community/moderation/flagged': { items: [] },
    });
    await expect(coachCommunityApi.getDashboard()).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('getCohortDetail reads the space and its roster (community.controller.ts:79, community-cohort-members.controller.ts:40)', async () => {
    serveGets({
      // community-cohort.dto.ts:41-64 — flat, no envelope.
      [`/community/cohorts/${COHORT_ID}`]: {
        feature_flag_state: 'enabled',
        ...serverCohortSummary,
        package_ids: [],
        created_at: '2026-10-01T00:00:00.000Z',
        my_membership: null,
        my_role: undefined,
      },
      // community-cohort-members.dto.ts:85-90.
      [`/community/cohorts/${COHORT_ID}/members`]: {
        members: [
          serverMember({ role: 'coach', user_id: WORKSPACE_ID, display_name: 'Coach Sam' }),
          serverMember(),
          serverMember({ user_id: ROW_1, display_name: 'Gone', status: 'removed' }),
        ],
        next_cursor: null,
      },
    });
    const res = await coachCommunityApi.getCohortDetail(COHORT_ID);
    expect(api.get).toHaveBeenCalledWith(`/community/cohorts/${COHORT_ID}/members`, {
      params: { limit: '100' },
    });
    expect(res.cohort).toMatchObject({ id: COHORT_ID, name: 'Spring', member_count: 4 });
    expect(res.members.map((m) => [m.name, m.role])).toEqual([
      ['Coach Sam', 'owner'],
      ['Dana Reyes', 'client'],
    ]);
    expect(res.members[1]).toMatchObject({
      user_id: USER_ID,
      email: 'dana@example.com',
      avatar_url: null,
    });
  });

  it('getCohortDetail reads every roster page (next_cursor)', async () => {
    const pages: Record<string, unknown> = {
      first: { members: [serverMember()], next_cursor: 'c2' },
      c2: { members: [serverMember({ user_id: ROW_1, display_name: 'Ola Ade' })], next_cursor: null },
    };
    const space = { ...serverCohortSummary, created_at: '2026-10-01T00:00:00.000Z' };
    api.get.mockImplementation((url: string, cfg?: { params?: { cursor?: string } }) =>
      Promise.resolve({ data: url.endsWith('/members') ? pages[cfg?.params?.cursor ?? 'first'] : space }));
    const res = await coachCommunityApi.getCohortDetail(COHORT_ID);
    expect(res.members.map((m) => m.name)).toEqual(['Dana Reyes', 'Ola Ade']);
    expect(api.get).toHaveBeenLastCalledWith(`/community/cohorts/${COHORT_ID}/members`, {
      params: { limit: '100', cursor: 'c2' },
    });
  });

  it('getFlagged unwraps the items array', async () => {
    api.get.mockResolvedValueOnce({ data: { items: [] } });
    const res = await coachCommunityApi.getFlagged();
    expect(api.get).toHaveBeenCalledWith('/community/moderation/flagged');
    expect(res).toEqual([]);
  });

  it('no call uses the old /community/coach/{dashboard,inbox,cohorts} routes', async () => {
    serveGets({});
    await Promise.allSettled([
      coachCommunityApi.getDashboard(),
      coachCommunityApi.getInbox(),
      coachCommunityApi.getCohorts(),
      coachCommunityApi.getCohortDetail(COHORT_ID),
    ]);
    for (const [url] of api.get.mock.calls) {
      expect(url).not.toMatch(/\/community\/coach\/(dashboard|inbox|cohorts)/);
    }
  });
});

describe('coachCommunityApi — mutations carry Idempotency-Key + no coachId', () => {
  it('createCohort posts to POST /community/workspaces/:id/cohorts (community-cohort-write.controller.ts:40)', async () => {
    // community-me.dto.ts:27 — the coach's workspace id.
    serveGets({ '/community/me': { workspace_id: WORKSPACE_ID } });
    // community-cohort.dto.ts:124-143 inside { cohort } (:149-151).
    api.post.mockResolvedValueOnce({
      data: {
        cohort: {
          id: COHORT_ID,
          workspace_id: WORKSPACE_ID,
          name: 'Winter',
          description: null,
          status: 'active',
          capacity: null,
          starts_at: null,
          ends_at: null,
          sort_order: 0,
          kind: 'chat',
          posting_policy: 'all',
          visibility: 'clients',
          package_ids: [],
          created_at: '2026-10-22T00:00:00.000Z',
          updated_at: '2026-10-22T00:00:00.000Z',
          archived_at: null,
        },
      },
    });
    const res = await coachCommunityApi.createCohort({ name: 'Winter' });
    const [url, body, config] = api.post.mock.calls[0];
    expect(url).toBe(`/community/workspaces/${WORKSPACE_ID}/cohorts`);
    expect(body).toEqual({ name: 'Winter' });
    expect(config).toEqual(IDEM);
    // The payload must NOT contain a coachId — the JWT is the only authority.
    expect(JSON.stringify(body)).not.toMatch(/coachId/i);
    expect(res).toMatchObject({ id: COHORT_ID, name: 'Winter', member_count: 0, unread_count: 0 });
  });

  it('createCohort with no workspace fails without posting', async () => {
    serveGets({ '/community/me': { workspace_id: null } });
    await expect(coachCommunityApi.createCohort({ name: 'Winter' })).rejects.toMatchObject({
      kind: 'contract',
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('inviteMember posts email + role student (community-cohort-members.controller.ts:52, dto :34-35)', async () => {
    // community-cohort-members.dto.ts:96-98.
    api.post.mockResolvedValueOnce({
      data: { member: serverMember({ status: 'invited', joined_at: null }) },
    });
    const res = await coachCommunityApi.inviteMember(COHORT_ID, {
      email: 'dana@example.com',
    });
    expect(api.post).toHaveBeenCalledWith(
      `/community/cohorts/${COHORT_ID}/members`,
      { email: 'dana@example.com', role: 'student' },
      IDEM,
    );
    expect(res).toMatchObject({ name: 'Dana Reyes', role: 'client', joined_at: null });
  });

  it('removeMember deletes the member by userId (community-cohort-members.controller.ts:64)', async () => {
    api.delete.mockResolvedValueOnce({ data: { member: serverMember({ status: 'removed' }) } });
    await coachCommunityApi.removeMember(COHORT_ID, USER_ID);
    expect(api.delete).toHaveBeenCalledWith(
      `/community/cohorts/${COHORT_ID}/members/${USER_ID}`,
    );
  });

  it('a failed invite is an error', async () => {
    api.post.mockRejectedValueOnce(axiosError(403));
    await expect(
      coachCommunityApi.inviteMember(COHORT_ID, { email: 'dana@example.com' }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it.each(['hide', 'warn', 'ban', 'dismiss'] as const)(
    'actOnItem(%s) PATCHes the moderation item route with an idempotency header',
    async (action) => {
      api.patch.mockResolvedValueOnce({ data: {} });
      await coachCommunityApi.actOnItem('dddddddd-dddd-dddd-dddd-dddddddddddd', action);
      expect(api.patch).toHaveBeenCalledWith(
        '/community/moderation/items/dddddddd-dddd-dddd-dddd-dddddddddddd',
        { action },
        { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
      );
      expect(api.post).not.toHaveBeenCalled();
    },
  );

  it('actOnItem forwards moderator notes', async () => {
    api.patch.mockResolvedValueOnce({ data: {} });
    await coachCommunityApi.actOnItem('dddddddd-dddd-dddd-dddd-dddddddddddd', 'warn', 'first warning');
    expect(api.patch).toHaveBeenCalledWith(
      '/community/moderation/items/dddddddd-dddd-dddd-dddd-dddddddddddd',
      { action: 'warn', notes: 'first warning' },
      { headers: { 'Idempotency-Key': 'test-idempotency-key' } },
    );
  });

  it('no longer calls the non-existent POST /community/{posts,messages}/:id/hide routes', () => {
    expect('hidePost' in coachCommunityApi).toBe(false);
    expect('hideMessage' in coachCommunityApi).toBe(false);
  });

  it('getFlagged accepts the backend flagged shape (author_user_id, workspace_id, notes)', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            workspace_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            target_type: 'message',
            target_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
            content: 'Removed',
            author_user_id: null,
            author_name: 'Member',
            cohort_name: null,
            reason: 'harassment',
            notes: null,
            created_at: '2026-09-30T00:00:00.000Z',
          },
        ],
      },
    });
    const res = await coachCommunityApi.getFlagged();
    expect(res[0].reason).toBe('harassment');
  });

  it('getFlagged accepts voice-note and win reports with playback media and the 24-hour respond-by', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            workspace_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            target_type: 'voice_note',
            target_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
            content: 'Voice note, 0:42',
            media: {
              kind: 'voice_note',
              url: 'https://storage.example.test/signed',
              duration_ms: 42000,
              mime_type: 'audio/mp4',
            },
            removed: false,
            author_user_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
            author_name: 'Bob Member',
            cohort_name: 'Spring plan',
            reason: 'harassment',
            notes: null,
            created_at: '2026-09-30T00:00:00.000Z',
            respond_by: '2026-10-01T00:00:00.000Z',
            overdue: true,
          },
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
            workspace_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            target_type: 'win',
            target_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
            content: 'Best week\n\nBuy my plan here',
            media: null,
            removed: false,
            author_user_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
            author_name: 'Alice Member',
            cohort_name: null,
            reason: 'spam',
            notes: null,
            created_at: '2026-09-30T00:00:00.000Z',
            respond_by: '2026-10-01T00:00:00.000Z',
            overdue: false,
          },
        ],
      },
    });
    const res = await coachCommunityApi.getFlagged();
    expect(res.map((r) => r.target_type)).toEqual(['voice_note', 'win']);
    expect(res[0].media).toEqual({
      kind: 'voice_note',
      url: 'https://storage.example.test/signed',
      duration_ms: 42000,
      mime_type: 'audio/mp4',
    });
    expect(res[0].overdue).toBe(true);
    expect(res[1].media).toBeNull();
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
    await expect(coachCommunityApi.getCohorts()).rejects.toMatchObject({
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

  it('throws a contract error when the cohorts shape drifts', async () => {
    api.get.mockResolvedValueOnce({ data: { cohorts: [{ id: 'not-a-uuid' }] } });
    const err = await coachCommunityApi.getCohorts().catch((e) => e);
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
