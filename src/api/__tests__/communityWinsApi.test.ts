/**
 * communityWinsApi + the community failure copy for wins, voice notes and the
 * blocker's DM refusal (Apple 1.2; owner rule 13:34, no generic errors).
 */
import { communityWinsApi, normalizeWin } from '../communityWinsApi';
import { describeCommunityFailure, COMMUNITY_SUPPORT_EMAIL } from '../communityErrors';
import { SUPPORT_EMAIL } from '../../constants/support';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../utils/idempotency', () => ({
  __esModule: true,
  generateIdempotencyKey: () => 'test-idem-key',
  randomUuid: () => 'abcdef12-0000-4000-8000-000000000000',
}));

const mockCapture = jest.fn();
jest.mock('../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

function httpError(status: number, data: unknown): unknown {
  return {
    isAxiosError: true,
    response: { status, data, headers: {} },
    config: { headers: {} },
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  mockCapture.mockReset();
});

describe('communityWinsApi', () => {
  const row = {
    id: 'win-1',
    user_id: 'u-alice',
    display_name: 'Alice',
    title: 'Deadlift PR',
    description: '100 kg',
    created_at: '2026-09-30T10:00:00.000Z',
    is_mine: false,
    displayName: 'Alice',
    action: 'Deadlift PR',
    createdAt: '2026-09-30T10:00:00.000Z',
  };

  it('reads the feed and normalises it for the screen', async () => {
    api.get.mockResolvedValueOnce({ data: [row] });
    const feed = await communityWinsApi.getFeed('u-bob');
    expect(api.get).toHaveBeenCalledWith('/community/feed');
    expect(feed).toEqual([
      {
        id: 'win-1',
        userId: 'u-alice',
        displayName: 'Alice',
        title: 'Deadlift PR',
        description: '100 kg',
        createdAt: '2026-09-30T10:00:00.000Z',
        isMine: false,
      },
    ]);
  });

  it('renders an older backend feed (legacy keys only) without blank cards or NaN dates', () => {
    const win = normalizeWin(
      {
        id: 'w',
        displayName: 'Sam',
        action: 'Ran 5k',
        createdAt: '2026-09-30T10:00:00.000Z',
      },
      'u-me',
    );
    expect(win).toMatchObject({
      title: 'Ran 5k',
      displayName: 'Sam',
      isMine: false,
    });
    expect(win.createdAt).toBe('2026-09-30T10:00:00.000Z');
    expect(normalizeWin({ id: 'w2', createdAt: 'not a date' }).createdAt).toBeNull();
    expect(normalizeWin({ id: 'w3', user_id: 'u-me' }, 'u-me').isMine).toBe(true);
  });

  it('posts a win with an idempotency key and deletes by id', async () => {
    api.post.mockResolvedValueOnce({ data: { ...row, is_mine: true } });
    const win = await communityWinsApi.postWin({
      title: 'Deadlift PR',
      description: '100 kg',
    });
    expect(api.post).toHaveBeenCalledWith(
      '/community/wins',
      { title: 'Deadlift PR', description: '100 kg' },
      { headers: { 'Idempotency-Key': 'test-idem-key' } },
    );
    expect(win.isMine).toBe(true);
    api.delete.mockResolvedValueOnce({ data: { id: 'win-1', deleted: true } });
    await communityWinsApi.deleteWin('win-1');
    expect(api.delete).toHaveBeenCalledWith('/community/wins/win-1');
  });

  it('keeps the server reason when a win is refused (the screen keeps the draft)', async () => {
    api.post.mockRejectedValueOnce(
      httpError(422, {
        code: 'community.content.rejected',
        message:
          'This was not posted because it appears to contain abusive language. Please rephrase it.',
      }),
    );
    const err = await communityWinsApi
      .postWin({ title: 'x', description: 'y' })
      .catch((e: unknown) => e);
    const failure = describeCommunityFailure(err, 'send_win');
    expect(failure.title).toBe('Please rephrase');
    expect(failure.message).toContain('Please rephrase it.');
  });
});

describe('describeCommunityFailure — wins, voice notes, DM block', () => {
  it('tells the blocker how to message again (C-314-3)', () => {
    const f = describeCommunityFailure(
      httpError(403, { code: 'community.dm.blocked_by_you' }),
      'send_message',
    );
    expect(f.message).toBe(
      'You blocked this member. To message them again, unblock them in Community safety.',
    );
    expect(f.reference).toBeNull();
  });

  it('maps every voice and win code to specific copy, never the support fallback', () => {
    for (const code of [
      'community.win.not_found',
      'community.win.removed_member',
      'community.voice.not_found',
      'community.voice.dm_not_supported',
      'community.voice.not_author',
      'community.voice.mime_rejected',
      'community.voice.duration_out_of_range',
      'community.voice.size_out_of_range',
      'community.voice.size_duration_mismatch',
      'community.voice.storage_key_rejected',
      'community.voice.ambiguous_target',
      'community.voice.not_entitled',
    ]) {
      const f = describeCommunityFailure(httpError(400, { code }), 'send_voice');
      expect(f.reference).toBeNull();
      expect(f.message).not.toMatch(/!/);
      expect(f.message).not.toMatch(/something went wrong/i);
      expect(f.message.length).toBeGreaterThan(20);
    }
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('an unexpected failure quotes the one support address and a reference', () => {
    expect(COMMUNITY_SUPPORT_EMAIL).toBe(SUPPORT_EMAIL);
    const f = describeCommunityFailure(httpError(500, {}), 'load_wins');
    expect(f.title).toBe('Wins not loaded');
    expect(f.message).toContain(SUPPORT_EMAIL);
    expect(f.reference).toMatch(/^[A-Z0-9]{8}$/);
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });
});
