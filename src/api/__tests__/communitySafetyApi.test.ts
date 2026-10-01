/**
 * communitySafetyApi — contract tests for the Apple 1.2 UGC safety client:
 * report, block / unblock, block list, safety info, and the 422 / error-code
 * helpers that screens use to keep a draft and explain a rejection.
 */
import axios from 'axios';
import {
  communitySafetyApi,
  contentRejectedMessage,
  communityErrorCode,
  blockErrorMessage,
  CONTENT_REJECTED_FALLBACK,
  COMMUNITY_GUIDELINES,
  COMMUNITY_REPORT_REASONS,
  COMMUNITY_REPORT_SENT_MESSAGE,
  COMMUNITY_RESPONSE_COMMITMENT,
  COMMUNITY_REVIEW_WITHIN_24H,
  COMMUNITY_SAFETY_FALLBACK_EMAIL,
} from '../communitySafetyApi';
import { CommunityApiError } from '../communityApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

jest.mock('../../utils/idempotency', () => ({
  __esModule: true,
  generateIdempotencyKey: () => 'test-idem-key',
  randomUuid: () => 'abcdef12-0000-4000-8000-000000000000',
}));

jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

const USER = '11111111-1111-4111-8111-111111111111';
const POST = '22222222-2222-4222-8222-222222222222';

function axiosError(status: number, data?: unknown): Error {
  const err = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response?: { status: number; data?: unknown };
  };
  err.isAxiosError = true;
  err.response = { status, data };
  return err;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  jest
    .spyOn(axios, 'isAxiosError')
    .mockImplementation((e: unknown) => !!(e && (e as { isAxiosError?: boolean }).isAxiosError));
});

describe('communitySafetyApi calls', () => {
  it('report posts target + reason with an Idempotency-Key', async () => {
    api.post.mockResolvedValueOnce({ data: { id: 'r1' } });
    await communitySafetyApi.report({ target_type: 'comment', target_id: POST, reason: 'harassment' });
    expect(api.post).toHaveBeenCalledWith(
      '/community/moderation/reports',
      { target_type: 'comment', target_id: POST, reason: 'harassment' },
      { headers: { 'Idempotency-Key': 'test-idem-key' } },
    );
  });

  it('block posts the user id; unblock deletes it', async () => {
    api.post.mockResolvedValueOnce({ data: { blocked_user_id: USER, blocked: true } });
    await communitySafetyApi.block(USER);
    expect(api.post).toHaveBeenCalledWith(
      '/community/blocks',
      { user_id: USER },
      { headers: { 'Idempotency-Key': 'test-idem-key' } },
    );
    api.delete.mockResolvedValueOnce({ data: { blocked_user_id: USER, blocked: false } });
    await communitySafetyApi.unblock(USER);
    expect(api.delete).toHaveBeenCalledWith(`/community/blocks/${USER}`);
  });

  it('listBlocks unwraps the blocks array', async () => {
    api.get.mockResolvedValueOnce({
      data: { blocks: [{ user_id: USER, name: 'Sam', blocked_at: '2026-09-30T00:00:00.000Z' }] },
    });
    const res = await communitySafetyApi.listBlocks();
    expect(api.get).toHaveBeenCalledWith('/community/blocks');
    expect(res).toEqual([{ user_id: USER, name: 'Sam', blocked_at: '2026-09-30T00:00:00.000Z' }]);
  });

  it('getSafetyInfo validates the published contact payload', async () => {
    api.get.mockResolvedValueOnce({
      data: {
        contact_email: 'safety@example.com',
        report_reasons: [{ code: 'spam', label: 'Spam' }],
        guidelines: ['Be kind'],
        response_commitment: 'Within 24 hours',
      },
    });
    const info = await communitySafetyApi.getSafetyInfo();
    expect(api.get).toHaveBeenCalledWith('/community/safety');
    expect(info.contact_email).toBe('safety@example.com');
  });

  it('a drifted block list surfaces as a contract error', async () => {
    api.get.mockResolvedValueOnce({ data: { nope: true } });
    await expect(communitySafetyApi.listBlocks()).rejects.toMatchObject({ kind: 'contract' });
  });
});

describe('error helpers', () => {
  it('contentRejectedMessage reads the 422 server message through the CommunityApiError cause', async () => {
    api.post.mockRejectedValueOnce(
      axiosError(422, { code: 'community.content.rejected', message: 'Please rephrase.' }),
    );
    const err = await communitySafetyApi
      .report({ target_type: 'post', target_id: POST, reason: 'spam' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommunityApiError);
    expect(contentRejectedMessage(err)).toBe('Please rephrase.');
  });

  it('contentRejectedMessage falls back to calm copy without a message', () => {
    expect(contentRejectedMessage(axiosError(422, { code: 'community.content.rejected' }))).toBe(
      CONTENT_REJECTED_FALLBACK,
    );
  });

  it('contentRejectedMessage ignores other 422s and other statuses', () => {
    expect(contentRejectedMessage(axiosError(422, { code: 'validation' }))).toBeNull();
    expect(contentRejectedMessage(axiosError(400, { code: 'community.content.rejected' }))).toBeNull();
    expect(contentRejectedMessage(new Error('x'))).toBeNull();
    expect(contentRejectedMessage(undefined)).toBeNull();
  });

  it('communityErrorCode + blockErrorMessage branch on server codes', () => {
    expect(communityErrorCode(axiosError(403, { code: 'community.dm.blocked' }))).toBe(
      'community.dm.blocked',
    );
    expect(blockErrorMessage(axiosError(403, { code: 'community.block.workspace_coach' }))).toMatch(
      /cannot block your coach/,
    );
    expect(blockErrorMessage(axiosError(400, { code: 'community.block.self' }))).toMatch(/yourself/);
    // server wording wins for member-facing block codes
    expect(
      blockErrorMessage(axiosError(404, { code: 'community.block.not_found', message: 'Server words.' })),
    ).toBe('Server words.');
    // unexpected: never a bare "try again"; carries a reference and the support email
    const unknown = blockErrorMessage(axiosError(500));
    expect(unknown).toMatch(/reference ABCDEF12/);
    expect(unknown).toMatch(/@/);
  });
});

describe('owner-approved community safety copy (2026-10-01 09:07 PDT)', () => {
  const H24 =
    'Reports are reviewed within 24 hours, every day, by your coach and The Growth Project team.';

  it('pins the 24-hour moderation sentence and the full commitment', () => {
    expect(COMMUNITY_REVIEW_WITHIN_24H).toBe(H24);
    expect(COMMUNITY_RESPONSE_COMMITMENT).toBe(
      `${H24} Content that breaks these guidelines is removed, and people who break them repeatedly lose access. If you block someone, they can no longer see your posts or message you, and they are not told.`,
    );
    expect(COMMUNITY_REPORT_SENT_MESSAGE).toBe(
      `Thank you. ${H24} Content that breaks these guidelines is removed, and people who break them repeatedly lose access.`,
    );
  });

  it('pins the safety contact email', () => {
    expect(COMMUNITY_SAFETY_FALLBACK_EMAIL).toBe('Bradley@Bradleytgpcoaching.com');
  });

  it('pins the seven guidelines, including rules 5 and 7', () => {
    expect(COMMUNITY_GUIDELINES).toHaveLength(7);
    expect(COMMUNITY_GUIDELINES[4]).toBe(
      "Keep private things private. Do not share anyone else's personal or health information.",
    );
    expect(COMMUNITY_GUIDELINES[6]).toBe(
      'This space is not for emergencies. If you are in danger, call 911. If you are struggling emotionally, call or text 988.',
    );
  });

  it('pins the report reason labels', () => {
    expect(COMMUNITY_REPORT_REASONS.map((r) => r.label)).toEqual([
      'Harassment or bullying',
      'Hate speech or discrimination',
      'Sexual or explicit content',
      'Threats or violence',
      'Self-harm or suicide',
      'Spam or scams',
      'Harmful health misinformation',
      'Something else',
    ]);
  });

  it('has no exclamation marks in shipped safety copy', () => {
    for (const line of [...COMMUNITY_GUIDELINES, COMMUNITY_RESPONSE_COMMITMENT, COMMUNITY_REPORT_SENT_MESSAGE]) {
      expect(line).not.toContain('!');
    }
  });
});
