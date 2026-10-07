/** B-SHARE-GUEST-127: the first-sign-in coach-sharing read and record (share-link buyers). */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockWarn = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  authApi: { getSignupPolicy: jest.fn() },
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: (...a: unknown[]) => mockWarn(...a) } }));

import {
  acceptFirstSignInCoachSharing,
  readFirstSignInCoachSharing,
} from '../coachSharingFirstSignIn';
import { coachSharingNoticeText } from '../coachSharingNotice';

const V1 = 'coach_sharing_join_v1';

beforeEach(() => jest.clearAllMocks());

describe('first-sign-in coach sharing', () => {
  it('current production (no route, 404): nothing to print, nothing logged', async () => {
    mockGet.mockRejectedValue({ response: { status: 404 } });
    await expect(readFirstSignInCoachSharing()).resolves.toBeNull();
    expect(mockGet).toHaveBeenCalledWith('/consent/coach-sharing-notice');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('an account linked outside the app that has not decided: the sentence names the coach', async () => {
    mockGet.mockResolvedValue({
      data: { applies: true, notice_version: V1, coach_id: 'coach-a', coach_name: ' Alex Rivera ' },
    });
    const notice = await readFirstSignInCoachSharing();
    expect(notice).toEqual({ version: V1, coachName: 'Alex Rivera' });
    expect(coachSharingNoticeText(notice?.coachName)).toBe(
      'Joining shares your workouts, food logs, weigh-ins and check-ins with Alex Rivera. Change this any time in Settings > Privacy.',
    );
  });

  it('already decided, no coach, another version, or a failed read: nothing to print', async () => {
    mockGet.mockResolvedValueOnce({ data: { applies: false, notice_version: V1, coach_id: 'coach-a', coach_name: 'A' } });
    await expect(readFirstSignInCoachSharing()).resolves.toBeNull();
    mockGet.mockResolvedValueOnce({ data: { applies: false, notice_version: V1, coach_id: null, coach_name: null } });
    await expect(readFirstSignInCoachSharing()).resolves.toBeNull();
    mockGet.mockResolvedValueOnce({ data: { applies: true, notice_version: 'coach_sharing_join_v2', coach_id: 'c', coach_name: 'A' } });
    await expect(readFirstSignInCoachSharing()).resolves.toBeNull();
    mockGet.mockRejectedValueOnce({ response: { status: 503 } });
    await expect(readFirstSignInCoachSharing()).resolves.toBeNull();
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('the tap under the sentence sends its version and reports the record', async () => {
    mockPost.mockResolvedValueOnce({ data: { coach_sharing_granted: true, coach_id: 'coach-a' } });
    await expect(acceptFirstSignInCoachSharing(V1)).resolves.toBe(true);
    expect(mockPost).toHaveBeenCalledWith('/consent/coach-sharing-notice', { coach_sharing_notice: V1 });
    mockPost.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(acceptFirstSignInCoachSharing(V1)).resolves.toBe(false);
  });
});
