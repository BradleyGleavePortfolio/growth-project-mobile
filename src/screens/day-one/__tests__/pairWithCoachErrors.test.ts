/**
 * Day-1 pairing refusals: the backend answers a NEW redemption of a code that
 * exists but cannot take a signup with `{ code: 'code_revoked' | 'code_expired'
 * | 'code_exhausted' }` in the error envelope (growth-project-backend
 * src/invite-codes/invite-codes.service.ts inviteCodeLifecycleRefusal). Each
 * gets its own kind so the screen never tells a client a real code is
 * "not recognized".
 */
import { authApi } from '../../../services/api';
import { pairWithCoach } from '../api';

jest.mock('../../../services/api', () => ({
  authApi: { attachInviteCode: jest.fn() },
  profileApi: { update: jest.fn() },
  preferencesApi: { patch: jest.fn() },
  notificationsApi: { updatePreferences: jest.fn() },
}));

const attach = authApi.attachInviteCode as jest.Mock;

function refusal(status: number, data: Record<string, unknown>) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { statusCode: status, ...data } },
  });
}

async function kindFor(status: number, data: Record<string, unknown>) {
  attach.mockRejectedValueOnce(refusal(status, data));
  const res = await pairWithCoach(' GP-ABC234 ');
  expect(attach).toHaveBeenLastCalledWith('GP-ABC234');
  if (res.ok) throw new Error('expected a refusal');
  return res.error.kind;
}

beforeEach(() => attach.mockReset());

describe('pairWithCoach refusal kinds', () => {
  it('code_revoked -> invite_revoked (the coach turned the code off)', async () => {
    expect(await kindFor(400, { code: 'code_revoked', message: 'This code was turned off by the coach who shared it.' })).toBe(
      'invite_revoked',
    );
  });

  it('code_expired -> invite_expired', async () => {
    expect(await kindFor(400, { code: 'code_expired' })).toBe('invite_expired');
  });

  it('code_exhausted -> invite_max_uses', async () => {
    expect(await kindFor(400, { code: 'code_exhausted' })).toBe('invite_max_uses');
  });

  it('coach_not_accepting_clients and already_attached_to_different_coach get their own kinds', async () => {
    expect(await kindFor(403, { code: 'coach_not_accepting_clients' })).toBe('coach_unavailable');
    expect(await kindFor(409, { code: 'already_attached_to_different_coach' })).toBe('already_paired');
  });

  it('an unknown code stays invite_invalid, and the legacy `reason` shape still maps', async () => {
    expect(await kindFor(400, { code: 'invite_code_invalid' })).toBe('invite_invalid');
    expect(await kindFor(400, { reason: 'expired' })).toBe('invite_expired');
    expect(await kindFor(400, { reason: 'max_uses_reached' })).toBe('invite_max_uses');
  });

  it('a 5xx is a server error, not a code problem', async () => {
    expect(await kindFor(503, { code: 'code_revoked' })).toBe('server');
  });
});
