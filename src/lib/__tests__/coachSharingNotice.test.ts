/** B-SHARE-127: sentence and field follow the version GET /auth/signup-policy advertises (production: none). */
jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    defaults: { headers: { common: {} } },
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __instance: instance };
});
jest.mock('expo-apple-authentication', () => ({ AppleAuthenticationScope: {}, signInAsync: jest.fn(), isAvailableAsync: jest.fn() }));

import { authApi } from '../../services/api';
import * as notice from '../coachSharingNotice';
import { buildAppleAuthBody } from '../../utils/appleAuth';
import { claimPendingInviteCode } from '../pendingInviteCode';
import { pairWithCoach } from '../../screens/day-one/api';

const { get, post } = (jest.requireMock('axios') as { __instance: { get: jest.Mock; post: jest.Mock } }).__instance;
const V1 = 'coach_sharing_join_v1';
const SENT = { invite_code: 'GP-A', coach_sharing_notice: V1 };

beforeEach(() => {
  notice.resetCoachSharingNoticeForTests();
  get.mockReset().mockResolvedValue({ data: {} });
  post.mockReset().mockResolvedValue({ data: {} });
});

it('shows the sentence only for the version and field this build knows', async () => {
  expect(notice.noticeVersionFromPolicy({ invite_code_required: true, providers: ['email'] })).toBeNull();
  expect(notice.noticeVersionFromPolicy({ coach_sharing_notice: V1, coach_sharing_notice_field: 'coach_sharing_notice' })).toBe(V1);
  expect(notice.noticeVersionFromPolicy({ coach_sharing_notice: 'coach_sharing_join_v2' })).toBeNull();
  expect(notice.noticeVersionFromPolicy({ coach_sharing_notice: V1, coach_sharing_notice_field: 'other' })).toBeNull();
  expect(notice.coachSharingNoticeText('Alex Rivera')).toBe(
    'Joining shares your workouts, food logs, weigh-ins and check-ins with Alex Rivera. Change this any time in Settings > Privacy.',
  );
  expect(notice.coachSharingNoticeText(' ')).toContain('with your coach.');
});

it('reads the policy once per run and again after a failed read', async () => {
  get.mockRejectedValueOnce(new Error('offline'));
  await expect(notice.loadCoachSharingNotice()).resolves.toBeNull();
  get.mockResolvedValueOnce({ data: { coach_sharing_notice: V1 } });
  await expect(notice.loadCoachSharingNotice()).resolves.toBe(V1);
  await expect(notice.loadCoachSharingNotice()).resolves.toBe(V1);
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledWith('/auth/signup-policy');
});

it('every join request carries the field only with a version (and, for sign-in, a code)', async () => {
  await authApi.attachInviteCode('GP-A');
  expect(post).toHaveBeenLastCalledWith('/auth/attach-invite-code', { invite_code: 'GP-A' });
  await authApi.attachInviteCode('GP-A', V1);
  expect(post).toHaveBeenLastCalledWith('/auth/attach-invite-code', SENT);
  await claimPendingInviteCode('GP-A', V1);
  expect(post).toHaveBeenLastCalledWith('/auth/attach-invite-code', SENT);
  await pairWithCoach(' GP-A ', V1);
  expect(post).toHaveBeenLastCalledWith('/auth/attach-invite-code', SENT);
  await pairWithCoach('GP-A', null);
  expect(post).toHaveBeenLastCalledWith('/auth/attach-invite-code', { invite_code: 'GP-A' });

  await authApi.googleAuth('TOK', 'GP-A', undefined, V1);
  expect(post).toHaveBeenLastCalledWith('/auth/google', { token: 'TOK', ...SENT });
  await authApi.googleAuth('TOK', undefined, undefined, V1);
  expect(post).toHaveBeenLastCalledWith('/auth/google', { token: 'TOK' });

  expect(buildAppleAuthBody({ identityToken: 'T', inviteCode: 'GP-A', coachSharingNotice: V1 })).toEqual({ token: 'T', ...SENT });
  expect(buildAppleAuthBody({ identityToken: 'T', inviteCode: 'GP-A' })).toEqual({ token: 'T', invite_code: 'GP-A' });
  expect(buildAppleAuthBody({ identityToken: 'T', coachSharingNotice: V1 })).toEqual({ token: 'T' });
});
