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
  expect(attach).toHaveBeenLastCalledWith('GP-ABC234', undefined);
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

// 1TO1-FU-M (#185-S1 op 1, LS-1TO1R3 C1): every answer the server gives for a coach who cannot take a new
// client (backend main today: 404 PACKAGE_NOT_FOUND; after 1TO1-FU-BE: the not-accepting code) reads as
// coach_unavailable, never "code not recognized". A 404 with no such answer stays invite_invalid.
describe('a refused join to a coach who cannot take new clients', () => {
  it.each<[string, number, Record<string, unknown>]>([
    ['today: 404 PACKAGE_NOT_FOUND in error', 404, { error: 'PACKAGE_NOT_FOUND', message: 'Package not available' }],
    ['today: 404 PACKAGE_NOT_FOUND in code', 404, { code: 'PACKAGE_NOT_FOUND' }],
    ['coach_not_accepting_clients (409)', 409, { code: 'coach_not_accepting_clients' }],
    ['coach_not_accepting_clients (404)', 404, { code: 'coach_not_accepting_clients' }],
    ['coach_not_accepting (409)', 409, { code: 'coach_not_accepting' }],
  ])('%s -> coach_unavailable', async (_name, status, data) => {
    expect(await kindFor(status, data)).toBe('coach_unavailable');
  });

  it('a 404 with no such answer stays invite_invalid', async () => {
    expect(await kindFor(404, { error: 'Not Found' })).toBe('invite_invalid');
  });
});
