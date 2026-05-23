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
  it('accepts a reasonable URL-safe token', () => {
    expect(isValidInviteToken('abcd_EFGH-1234.xy')).toBe(true);
  });

  it('rejects path traversal / whitespace / oversize', () => {
    expect(isValidInviteToken('')).toBe(false);
    expect(isValidInviteToken('a')).toBe(false);
    expect(isValidInviteToken('foo/bar')).toBe(false);
    expect(isValidInviteToken('foo bar')).toBe(false);
    expect(isValidInviteToken('a'.repeat(200))).toBe(false);
    expect(isValidInviteToken('<script>')).toBe(false);
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
        results: [
          { email: 'a@ex.com', status: 'created', emailQueued: true },
          { email: 'b@ex.com', status: 'reused', emailQueued: true },
        ],
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
    mockedApi.post.mockResolvedValueOnce({ data: { results: [] } });
    await invitesApi.bulkInvite(['a@ex.com']);
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/coach/invite-codes/bulk',
      { rows: [{ email: 'a@ex.com' }] },
    );
  });

  it('surfaces per-email statuses from the response', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        results: [
          { email: 'a@ex.com', status: 'created', emailQueued: true },
          { email: 'c@ex.com', status: 'failed', emailQueued: false, error: 'x' },
        ],
      },
    });
    const res = await invitesApi.bulkInvite(['a@ex.com', 'c@ex.com']);
    expect(res.results.map((r) => r.status)).toEqual(['created', 'failed']);
  });
});

describe('invitesApi.listInvites', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.get.mockResolvedValue({
      data: {
        invites: [
          { id: '1', code: 'a', status: 'PENDING', createdAt: 't' },
          { id: '2', code: 'b', status: 'ACCEPTED', createdAt: 't' },
          { id: '3', code: 'c', status: 'EXPIRED', createdAt: 't' },
          { id: '4', code: 'd', status: 'REVOKED', createdAt: 't' },
        ],
      },
    });
  });

  it('returns all by default', async () => {
    const out = await invitesApi.listInvites();
    expect(out).toHaveLength(4);
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
    const out = await invitesApi.acceptInvite('tok_123');
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
    await invitesApi.acceptInvite('tok_123');
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
    const out = await invitesApi.acceptInvite('tok_old');
    expect(out).toEqual({ accepted: false, reason: 'expired' });
  });

  it('falls back to invalid when body cannot be parsed', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => null,
    });
    const out = await invitesApi.acceptInvite('tok_x');
    expect(out).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('throws on server errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(invitesApi.acceptInvite('tok_x')).rejects.toThrow();
  });
});
