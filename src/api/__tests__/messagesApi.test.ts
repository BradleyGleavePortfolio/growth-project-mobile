/**
 * Behavior tests for the moderation slice of messagesApi.
 *
 * The wire contract is owned by backend PR #263 (merged). These tests pin
 * every call shape mobile sends so a future client refactor that quietly
 * drifts from the contract trips the suite (R26 + R29).
 *
 * Coverage:
 *   - report(): POST /messages/report with { messageId, reason, details }
 *   - report(): every ReportReason value is exactly what backend accepts
 *   - report(): details truncated to DETAILS_MAX (1000)
 *   - report(): non-2xx throws (no soft-success / no swallowed 4xx)
 *   - block(): POST /users/:id/block
 *   - unblock(): DELETE /users/:id/block
 *   - listBlocked(): parses backend array into BlockedUserRow[]
 */
import {
  messagesModerationApi,
  REPORT_REASON_OPTIONS,
  DETAILS_MAX,
  ReportReason,
} from '../messagesApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  post: jest.Mock;
  get: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  api.post.mockReset();
  api.get.mockReset();
  api.delete.mockReset();
});

describe('messagesModerationApi.report', () => {
  it('POSTs /messages/report with the exact backend body', async () => {
    api.post.mockResolvedValueOnce({ data: { id: 'rep-1' } });
    const res = await messagesModerationApi.report('msg-123', {
      reason: 'spam',
      details: 'sketchy link',
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/messages/report', {
      messageId: 'msg-123',
      reason: 'spam',
      details: 'sketchy link',
    });
    expect(res).toEqual({ ok: true, report_id: 'rep-1' });
  });

  it('omits details when caller did not supply any', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await messagesModerationApi.report('msg-1', { reason: 'other' });
    expect(api.post.mock.calls[0][1]).toEqual({
      messageId: 'msg-1',
      reason: 'other',
      details: undefined,
    });
  });

  it.each(REPORT_REASON_OPTIONS.map((o) => o.value))(
    'sends reason "%s" verbatim (no rewrites or drift)',
    async (reason: ReportReason) => {
      api.post.mockResolvedValueOnce({ data: {} });
      await messagesModerationApi.report('msg-1', { reason });
      expect(api.post.mock.calls[0][1].reason).toBe(reason);
    },
  );

  it('uses backend reason "sexual" (never legacy "sexual_content")', () => {
    const values = REPORT_REASON_OPTIONS.map((o) => o.value);
    expect(values).toContain('sexual');
    expect(values).not.toContain('sexual_content');
    expect(values).not.toContain('self_harm');
    // Backend-accepted reasons from PR #263.
    expect(values).toEqual(
      expect.arrayContaining([
        'spam',
        'harassment',
        'sexual',
        'hate_speech',
        'violence',
        'misinformation',
        'other',
      ]),
    );
  });

  it('caps details at DETAILS_MAX (1000)', async () => {
    expect(DETAILS_MAX).toBe(1000);
    api.post.mockResolvedValueOnce({ data: {} });
    const huge = 'x'.repeat(1500);
    await messagesModerationApi.report('msg-1', { reason: 'spam', details: huge });
    const sent = api.post.mock.calls[0][1].details as string;
    expect(sent.length).toBe(1000);
  });

  it('throws on 4xx — no soft-success, no fabricated confirmation', async () => {
    const err = Object.assign(new Error('bad'), {
      response: { status: 400, data: { error: 'MESSAGE_NOT_FOUND' } },
    });
    api.post.mockRejectedValueOnce(err);
    await expect(
      messagesModerationApi.report('msg-1', { reason: 'spam' }),
    ).rejects.toBe(err);
  });

  it('throws on 404 (legacy soft-success path removed)', async () => {
    const err = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    api.post.mockRejectedValueOnce(err);
    await expect(
      messagesModerationApi.report('msg-1', { reason: 'spam' }),
    ).rejects.toBe(err);
  });

  it('rejects empty messageId without hitting the network', async () => {
    await expect(
      messagesModerationApi.report('', { reason: 'spam' }),
    ).rejects.toThrow(/messageId/);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('messagesModerationApi.block', () => {
  it('POSTs /users/:id/block (URL-encoded)', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await messagesModerationApi.block('u 1');
    expect(api.post).toHaveBeenCalledWith('/users/u%201/block');
  });

  it('throws on non-2xx', async () => {
    const err = Object.assign(new Error('boom'), { response: { status: 500 } });
    api.post.mockRejectedValueOnce(err);
    await expect(messagesModerationApi.block('u1')).rejects.toBe(err);
  });
});

describe('messagesModerationApi.unblock', () => {
  it('DELETEs /users/:id/block (verb fixed from legacy POST /unblock)', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await messagesModerationApi.unblock('u1');
    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(api.delete).toHaveBeenCalledWith('/users/u1/block');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('throws on 4xx — no soft-success after wrong verb', async () => {
    const err = Object.assign(new Error('nope'), { response: { status: 404 } });
    api.delete.mockRejectedValueOnce(err);
    await expect(messagesModerationApi.unblock('u1')).rejects.toBe(err);
  });
});

describe('messagesModerationApi.listBlocked', () => {
  it('parses backend array { blockedId, displayName, blockedAt }', async () => {
    api.get.mockResolvedValueOnce({
      data: [
        { blockedId: 'u1', displayName: 'Alice', blockedAt: '2026-05-01T00:00:00Z' },
        { blockedId: 'u2', displayName: 'Bob', blockedAt: '2026-05-02T00:00:00Z' },
      ],
    });
    const res = await messagesModerationApi.listBlocked();
    expect(api.get).toHaveBeenCalledWith('/users/blocks');
    expect(res.blocked).toEqual([
      { blockedId: 'u1', displayName: 'Alice', blockedAt: '2026-05-01T00:00:00Z' },
      { blockedId: 'u2', displayName: 'Bob', blockedAt: '2026-05-02T00:00:00Z' },
    ]);
  });

  it('accepts a wrapper object { blocked: [...] } for forward compatibility', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        blocked: [
          { blockedId: 'u9', displayName: 'Z', blockedAt: '2026-01-01T00:00:00Z' },
        ],
      },
    });
    const res = await messagesModerationApi.listBlocked();
    expect(res.blocked).toHaveLength(1);
    expect(res.blocked[0].blockedId).toBe('u9');
  });

  it('drops malformed rows (missing blockedId)', async () => {
    api.get.mockResolvedValueOnce({
      data: [
        { displayName: 'nope' },
        { blockedId: '', displayName: 'empty' },
        { blockedId: 'u1', displayName: 'A', blockedAt: 'now' },
      ],
    });
    const res = await messagesModerationApi.listBlocked();
    expect(res.blocked.map((r) => r.blockedId)).toEqual(['u1']);
  });

  it('does not silently swallow the difference between "no blocks" and "server down"', async () => {
    api.get.mockRejectedValueOnce(new Error('network'));
    await expect(messagesModerationApi.listBlocked()).rejects.toThrow();
  });
});
