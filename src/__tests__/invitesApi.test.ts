/**
 * invitesApi.test — Email Pipeline v1.
 *
 * Coverage:
 *   - Bulk invite happy path surfaces per-email status entries.
 *   - 100-email cap rejects locally without a network round trip.
 *   - resendInvite degrades gracefully on 404.
 *   - List filter narrows results client-side.
 *   - acceptInvite uses a plain fetch (no JWT) and parses
 *     `accepted: true | false` payloads.
 *   - tokeniseEmails / parseCsvEmails honour separators + header
 *     detection.
 */

import {
  invitesApi,
  isValidEmail,
  MAX_BULK_EMAILS,
  normaliseEmail,
  parseCsvEmails,
  tokeniseEmails,
} from '../api/invites';

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

describe('invitesApi — local helpers', () => {
  it('isValidEmail', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('  alice@example.com ')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('normaliseEmail lowers + trims', () => {
    expect(normaliseEmail('  ALICE@EX.com  ')).toBe('alice@ex.com');
  });

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

  it('surfaces per-email statuses from the response', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: {
        results: [
          {
            email: 'a@ex.com',
            inviteId: 'inv_1',
            status: 'created',
            emailQueued: true,
          },
          {
            email: 'b@ex.com',
            inviteId: 'inv_2',
            status: 'reused',
            emailQueued: true,
          },
          {
            email: 'c@ex.com',
            status: 'failed',
            emailQueued: false,
            error: 'invalid',
          },
        ],
      },
    });
    const res = await invitesApi.bulkInvite(
      ['a@ex.com', 'b@ex.com', 'c@ex.com'],
      'hi',
    );
    expect(res.results).toHaveLength(3);
    expect(res.results[0].status).toBe('created');
    expect(res.results[1].status).toBe('reused');
    expect(res.results[2].status).toBe('failed');
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/coach/invite-codes/bulk',
      { emails: ['a@ex.com', 'b@ex.com', 'c@ex.com'], message: 'hi' },
    );
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

  it('returns { supported: true } on success', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} });
    const out = await invitesApi.resendInvite('inv_1');
    expect(out).toEqual({ supported: true });
  });

  it('returns { supported: false } on 404', async () => {
    mockedApi.post.mockRejectedValueOnce({ response: { status: 404 } });
    const out = await invitesApi.resendInvite('inv_1');
    expect(out).toEqual({ supported: false });
  });

  it('re-throws on non-404 errors', async () => {
    mockedApi.post.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(invitesApi.resendInvite('inv_1')).rejects.toBeTruthy();
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

  it('returns parsed success payload', async () => {
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
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invites/accept/tok_123'),
      expect.objectContaining({ method: 'POST' }),
    );
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

  it('URL-encodes the token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true }),
    });
    await invitesApi.acceptInvite('a/b');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('a%2Fb'),
      expect.anything(),
    );
  });
});
