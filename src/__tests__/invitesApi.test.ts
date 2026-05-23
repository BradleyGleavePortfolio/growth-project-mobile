/**
 * invitesApi.test — Email Pipeline v1 (behavioral).
 *
 * Covers:
 *   - Bulk invite hits `/coach/invite-codes/bulk` with the `rows` shape
 *     the backend DTO requires.
 *   - Bulk caps at 100 emails locally.
 *   - resendInvite hits `/coach/invite-codes/:id/send` with the required
 *     email body and degrades to `{ supported: false }` on 404.
 *   - listInvites filters client-side.
 *   - acceptInvite uses a raw fetch (NO auth header), short-circuits on
 *     malformed tokens, and parses structured success/failure payloads.
 *   - email + token validators reject the obvious unsafe shapes.
 */

import {
  invitesApi,
  isValidEmail,
  MAX_BULK_EMAILS,
  normaliseEmail,
  parseCsvEmails,
  tokeniseEmails,
} from '../api/invites';
import { isValidInviteToken } from '../utils/inviteToken';

jest.mock('../services/api', () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    },
  };
});

import api from '../services/api';

const mockedApi = api as jest.Mocked<typeof api>;

describe('invitesApi — email validator', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
    expect(isValidEmail('  alice@example.com ')).toBe(true);
    expect(isValidEmail('a.b+tag@sub.example.co')).toBe(true);
  });

  it('rejects empty / undefined', () => {
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('   ')).toBe(false);
  });

  it('rejects structurally bad addresses', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false); // no dot in domain
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('alice@')).toBe(false);
    expect(isValidEmail('alice@@example.com')).toBe(false);
    expect(isValidEmail('alice..bob@example.com')).toBe(false);
  });

  it('rejects display-unsafe characters', () => {
    expect(isValidEmail('alice<script>@example.com')).toBe(false);
    expect(isValidEmail('"al ice"@example.com')).toBe(false);
    expect(isValidEmail('al&ce@example.com')).toBe(false);
    expect(isValidEmail('alice@exa mple.com')).toBe(false);
  });

  it('rejects oversized addresses', () => {
    const long = 'a'.repeat(70) + '@example.com';
    expect(isValidEmail(long)).toBe(false); // local part > 64
    const huge = 'a@' + 'b'.repeat(260) + '.co';
    expect(isValidEmail(huge)).toBe(false);
  });

  it('normaliseEmail lowers + trims', () => {
    expect(normaliseEmail('  ALICE@EX.com  ')).toBe('alice@ex.com');
  });
});

describe('inviteToken — validator', () => {
  it('accepts a backend-shaped token (letters/digits/hyphens, 3–32)', () => {
    expect(isValidInviteToken('abcdEFGH-1234xy')).toBe(true);
    expect(isValidInviteToken('abc')).toBe(true);
    expect(isValidInviteToken('a'.repeat(32))).toBe(true);
  });

  it('rejects path traversal / whitespace / oversize / unsafe chars', () => {
    expect(isValidInviteToken('')).toBe(false);
    expect(isValidInviteToken('ab')).toBe(false);
    expect(isValidInviteToken('foo/bar')).toBe(false);
    expect(isValidInviteToken('foo bar')).toBe(false);
    expect(isValidInviteToken('a'.repeat(33))).toBe(false);
    expect(isValidInviteToken('a'.repeat(200))).toBe(false);
    expect(isValidInviteToken('<script>')).toBe(false);
  });

  it('rejects dots and underscores (out of backend character set)', () => {
    expect(isValidInviteToken('abcd_efgh')).toBe(false);
    expect(isValidInviteToken('abcd.efgh')).toBe(false);
    expect(isValidInviteToken('abcd_EFGH-1234.xy')).toBe(false);
  });
});

describe('invitesApi — paste / csv parsers', () => {
  it('tokeniseEmails splits on whitespace, comma, semicolon, newline and dedupes', () => {
    const out = tokeniseEmails(
      'a@b.co\nb@c.co , a@b.co; d@e.co  c@d.co\t a@b.co',
    );
    expect(out).toEqual(['a@b.co', 'b@c.co', 'd@e.co', 'c@d.co']);
  });

  it('parseCsvEmails: header-detection picks "email" column', () => {
    const csv = 'name,email,note\nAlice,alice@ex.com,hi\nBob,bob@ex.com,\n';
    expect(parseCsvEmails(csv)).toEqual(['alice@ex.com', 'bob@ex.com']);
  });

  it('parseCsvEmails: no header → column zero', () => {
    const csv = 'alice@ex.com,Alice\nbob@ex.com,Bob\n';
    expect(parseCsvEmails(csv)).toEqual(['alice@ex.com', 'bob@ex.com']);
  });

  it('parseCsvEmails: handles quoted fields with commas inside', () => {
    const csv = 'email,note\n"alice@ex.com","hi, friend"\n';
    expect(parseCsvEmails(csv)).toEqual(['alice@ex.com']);
  });

  it('parseCsvEmails: dedupes case-insensitively', () => {
    const csv = 'email\nAlice@Ex.com\nalice@ex.com\n';
    expect(parseCsvEmails(csv)).toEqual(['Alice@Ex.com']);
  });
});

describe('invitesApi.bulkInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects 0 emails synchronously', async () => {
    await expect(invitesApi.bulkInvite([])).rejects.toThrow();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('rejects > 100 emails without hitting the network', async () => {
    const emails = Array.from(
      { length: MAX_BULK_EMAILS + 1 },
      (_, i) => `u${i}@ex.com`,
    );
    await expect(invitesApi.bulkInvite(emails)).rejects.toThrow(/max/i);
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('sends a `rows` array matching the backend DTO shape', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        total: 2,
        created: [
          { email: 'a@ex.com', code: 'aaa-111', invite_code_id: 'i1', email_status: 'sent' },
          { email: 'b@ex.com', code: 'bbb-222', invite_code_id: 'i2', email_status: 'sent' },
        ],
        rejected: [],
      },
    });
    await invitesApi.bulkInvite(['a@ex.com', 'b@ex.com'], 'hi friend');
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/coach/invite-codes/bulk',
      {
        rows: [
          { email: 'a@ex.com', note: 'hi friend' },
          { email: 'b@ex.com', note: 'hi friend' },
        ],
      },
    );
  });

  it('omits `note` when no message is supplied', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { total: 1, created: [], rejected: [] },
    });
    await invitesApi.bulkInvite(['a@ex.com']);
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/coach/invite-codes/bulk',
      { rows: [{ email: 'a@ex.com' }] },
    );
  });

  it('adapts the backend { total, created[], rejected[] } shape into results[]', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        total: 3,
        created: [
          { email: 'a@ex.com', code: 'aaa-111', invite_code_id: 'i1', email_status: 'sent' },
          { email: 'c@ex.com', code: 'ccc-333', invite_code_id: 'i2', email_status: 'failed', email_error: 'bounce' },
        ],
        rejected: [
          { email: 'dup@ex.com', reason: 'duplicate_in_batch' },
        ],
      },
    });
    const res = await invitesApi.bulkInvite(['a@ex.com', 'c@ex.com', 'dup@ex.com']);
    expect(res.total).toBe(3);
    expect(res.createdCount).toBe(2);
    expect(res.rejectedCount).toBe(1);
    expect(res.results).toHaveLength(3);
    expect(res.results[0]).toMatchObject({
      email: 'a@ex.com',
      inviteId: 'i1',
      status: 'created',
      emailQueued: true,
    });
    expect(res.results[1]).toMatchObject({
      email: 'c@ex.com',
      inviteId: 'i2',
      status: 'failed',
      emailQueued: false,
      error: 'bounce',
    });
    expect(res.results[2]).toMatchObject({
      email: 'dup@ex.com',
      status: 'failed',
      emailQueued: false,
      error: 'duplicate_in_batch',
    });
  });
});

describe('invitesApi.listInvites', () => {
  const now = Date.now();
  const future = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
  const past = new Date(now - 24 * 3600 * 1000).toISOString();

  beforeEach(() => {
    jest.clearAllMocks();
    // Backend returns a raw Prisma array, snake_case fields. The
    // email-pipeline backend uses `client_email` and `last_email_status`;
    // legacy rows may still carry `intended_email`.
    mockedApi.get.mockResolvedValue({
      data: [
        {
          id: '1',
          code: 'a',
          coach_id: 'c',
          created_at: '2026-01-01T00:00:00Z',
          expires_at: future,
          max_uses: 1,
          used_count: 0,
          revoked: false,
          client_email: 'one@ex.com',
          last_email_status: 'SENT',
        },
        {
          id: '2',
          code: 'b',
          coach_id: 'c',
          created_at: '2026-01-01T00:00:00Z',
          expires_at: future,
          max_uses: 1,
          used_count: 1,
          revoked: false,
          client_email: 'two@ex.com',
          last_email_status: 'DELIVERED',
          accepted_by_user_id: 'u2',
          accepted_at: '2026-01-02T00:00:00Z',
        },
        {
          id: '3',
          code: 'c',
          coach_id: 'c',
          created_at: '2026-01-01T00:00:00Z',
          expires_at: past,
          max_uses: 1,
          used_count: 0,
          revoked: false,
          client_email: 'three@ex.com',
          last_email_status: null,
        },
        {
          id: '4',
          code: 'd',
          coach_id: 'c',
          created_at: '2026-01-01T00:00:00Z',
          expires_at: future,
          max_uses: 1,
          used_count: 0,
          revoked: true,
          client_email: 'four@ex.com',
        },
      ],
    });
  });

  it('returns all by default and maps snake_case → camelCase', async () => {
    const out = await invitesApi.listInvites();
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({
      id: '1',
      code: 'a',
      clientEmail: 'one@ex.com',
      status: 'PENDING',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(out[0].expiresAt).toBe(future);
  });

  it('maps client_email → clientEmail (canonical backend field)', async () => {
    const out = await invitesApi.listInvites();
    expect(out.map((i) => i.clientEmail)).toEqual([
      'one@ex.com',
      'two@ex.com',
      'three@ex.com',
      'four@ex.com',
    ]);
  });

  it('maps last_email_status → lastEmailStatus and preserves explicit null', async () => {
    const out = await invitesApi.listInvites();
    const byId = Object.fromEntries(
      out.map((i) => [i.id, i.lastEmailStatus]),
    );
    expect(byId['1']).toBe('SENT');
    expect(byId['2']).toBe('DELIVERED');
    // Explicit null in the payload must round-trip as null — NOT undefined.
    expect(byId['3']).toBeNull();
    // Field absent on row 4 → defaults to null (matches backend "no status yet").
    expect(byId['4']).toBeNull();
  });

  it('falls back to intended_email when client_email is missing (legacy rows)', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        {
          id: 'legacy-1',
          code: 'legacy',
          coach_id: 'c',
          created_at: '2026-01-01T00:00:00Z',
          used_count: 0,
          revoked: false,
          intended_email: 'legacy@ex.com',
        },
      ],
    });
    const out = await invitesApi.listInvites();
    expect(out).toHaveLength(1);
    expect(out[0].clientEmail).toBe('legacy@ex.com');
  });

  it('prefers client_email over intended_email when both are present', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        {
          id: 'both-1',
          code: 'both',
          coach_id: 'c',
          created_at: '2026-01-01T00:00:00Z',
          used_count: 0,
          revoked: false,
          client_email: 'canonical@ex.com',
          intended_email: 'legacy@ex.com',
        },
      ],
    });
    const out = await invitesApi.listInvites();
    expect(out[0].clientEmail).toBe('canonical@ex.com');
  });

  it('defaults clientEmail to empty string when both fields are absent', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: [
        {
          id: 'empty-1',
          code: 'empty',
          coach_id: 'c',
          created_at: '2026-01-01T00:00:00Z',
          used_count: 0,
          revoked: false,
        },
      ],
    });
    const out = await invitesApi.listInvites();
    expect(out[0].clientEmail).toBe('');
  });

  it('derives status from revoked / accepted / expires_at', async () => {
    const out = await invitesApi.listInvites();
    const byId = Object.fromEntries(out.map((i) => [i.id, i.status]));
    expect(byId).toEqual({
      '1': 'PENDING',
      '2': 'ACCEPTED',
      '3': 'EXPIRED',
      '4': 'REVOKED',
    });
  });

  it('filters PENDING', async () => {
    const out = await invitesApi.listInvites('pending');
    expect(out.map((i) => i.id)).toEqual(['1']);
  });

  it('filters ACCEPTED', async () => {
    const out = await invitesApi.listInvites('accepted');
    expect(out.map((i) => i.id)).toEqual(['2']);
  });

  it('filters EXPIRED', async () => {
    const out = await invitesApi.listInvites('expired');
    expect(out.map((i) => i.id)).toEqual(['3']);
  });

  it('also tolerates a legacy `{ invites: [...] }` envelope', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        invites: [
          {
            id: '9',
            code: 'z',
            coach_id: 'c',
            created_at: '2026-01-01T00:00:00Z',
            used_count: 0,
            revoked: false,
            client_email: 'nine@ex.com',
            last_email_status: 'QUEUED',
          },
        ],
      },
    });
    const out = await invitesApi.listInvites();
    expect(out).toHaveLength(1);
    expect(out[0].clientEmail).toBe('nine@ex.com');
    expect(out[0].lastEmailStatus).toBe('QUEUED');
  });
});

describe('invitesApi.resendInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hits the /send route with the recipient email body', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    const out = await invitesApi.resendInvite('inv_1', 'alice@ex.com');
    expect(out).toEqual({ supported: true });
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/coach/invite-codes/inv_1/send',
      { email: 'alice@ex.com' },
    );
  });

  it('forwards optional name/note in the body', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    await invitesApi.resendInvite('inv_1', 'alice@ex.com', {
      name: 'Alice',
      note: 'hello',
    });
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/coach/invite-codes/inv_1/send',
      { email: 'alice@ex.com', name: 'Alice', note: 'hello' },
    );
  });

  it('returns { supported: false } on 404', async () => {
    mockedApi.post.mockRejectedValueOnce({ response: { status: 404 } });
    const out = await invitesApi.resendInvite('inv_1', 'alice@ex.com');
    expect(out).toEqual({ supported: false });
  });

  it('re-throws on non-404 errors', async () => {
    mockedApi.post.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(
      invitesApi.resendInvite('inv_1', 'alice@ex.com'),
    ).rejects.toBeTruthy();
  });
});

describe('invitesApi.acceptInvite', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof global.fetch;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('short-circuits a malformed token without touching the network', async () => {
    const out = await invitesApi.acceptInvite('foo/bar');
    expect(out).toEqual({ accepted: false, reason: 'invalid' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('short-circuits an oversized token without touching the network', async () => {
    const out = await invitesApi.acceptInvite('a'.repeat(200));
    expect(out).toEqual({ accepted: false, reason: 'invalid' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns parsed success payload for a valid token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        coachName: 'Coach K',
        redirectTo: 'app_open',
      }),
    });
    const out = await invitesApi.acceptInvite('tok-123');
    expect(out).toEqual({
      accepted: true,
      coachName: 'Coach K',
      redirectTo: 'app_open',
    });
  });

  it('sends POST without any Authorization header', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true }),
    });
    await invitesApi.acceptInvite('tok-123');
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const headers = (init.headers ?? {}) as Record<string, string>;
    const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');
    expect(headerKeys).not.toContain('cookie');
  });

  it('returns structured failure on 410 expired', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ accepted: false, reason: 'expired' }),
    });
    const out = await invitesApi.acceptInvite('tok-old');
    expect(out).toEqual({ accepted: false, reason: 'expired' });
  });

  it('falls back to invalid when body cannot be parsed', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => null,
    });
    const out = await invitesApi.acceptInvite('tok-xyz');
    expect(out).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('throws on server errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(invitesApi.acceptInvite('tok-xyz')).rejects.toThrow();
  });
});
