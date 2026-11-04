/**
 * B5/B6 — Signed-in users keep their invite code; explicit claim attaches it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  claimPendingInviteCode,
  clearPendingInviteCode,
  readPendingInviteCode,
  writePendingInviteCode,
} from '../lib/pendingInviteCode';

jest.mock('../services/api', () => ({
  authApi: {
    attachInviteCode: jest.fn(),
  },
}));

// Lazy access to the mock so each test can configure its own resolution.
import { authApi } from '../services/api';

beforeEach(async () => {
  await AsyncStorage.clear();
  (authApi.attachInviteCode as jest.Mock).mockReset();
});

describe('pending invite code', () => {
  it('round-trips a code through AsyncStorage', async () => {
    await writePendingInviteCode('ABC123');
    expect(await readPendingInviteCode()).toBe('ABC123');
    await clearPendingInviteCode();
    expect(await readPendingInviteCode()).toBeNull();
  });

  it('treats whitespace-only stored values as missing', async () => {
    await AsyncStorage.setItem('pending_invite_code', '   ');
    expect(await readPendingInviteCode()).toBeNull();
  });

  it('claims via authApi.attachInviteCode and clears storage on success', async () => {
    await writePendingInviteCode('GROWTH-1');
    (authApi.attachInviteCode as jest.Mock).mockResolvedValueOnce({ data: {} });
    const result = await claimPendingInviteCode();
    expect(result.ok).toBe(true);
    expect(authApi.attachInviteCode).toHaveBeenCalledWith('GROWTH-1', undefined);
    expect(await readPendingInviteCode()).toBeNull();
  });

  it('clears storage on 4xx (permanent failure) but keeps it on 5xx', async () => {
    // Permanent failure → bail and clear
    await writePendingInviteCode('BAD');
    (authApi.attachInviteCode as jest.Mock).mockRejectedValueOnce({
      response: { status: 410, data: { reason: 'expired', message: 'Code expired.' } },
    });
    const bad = await claimPendingInviteCode();
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('expired');
    expect(await readPendingInviteCode()).toBeNull();

    // Transient failure → keep in storage so the user can retry
    await writePendingInviteCode('LATER');
    (authApi.attachInviteCode as jest.Mock).mockRejectedValueOnce({
      response: { status: 503 },
    });
    const transient = await claimPendingInviteCode();
    expect(transient.ok).toBe(false);
    expect(transient.reason).toBe('http_503');
    expect(await readPendingInviteCode()).toBe('LATER');
  });

  it('refuses to claim when there is no code', async () => {
    const r = await claimPendingInviteCode();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing');
    expect(authApi.attachInviteCode).not.toHaveBeenCalled();
  });
});

// 1TO1-FU-M (#185-S1 op 1, LS-1TO1R3 C1): the banner shows the existing not-accepting words for a coach who
// cannot take a new client, never the raw server text ("Package not available"), before and after 1TO1-FU-BE.
describe('a refused join to a coach who cannot take new clients', () => {
  const NOT_ACCEPTING =
    'Your coach is not accepting new clients through the app right now. Let them know, then try your code again.';
  it.each<[string, number, Record<string, unknown>]>([
    ['today: 404 PACKAGE_NOT_FOUND', 404, { statusCode: 404, error: 'PACKAGE_NOT_FOUND', message: 'Package not available' }],
    ['after 1TO1-FU-BE: coach_not_accepting_clients', 409, { code: 'coach_not_accepting_clients', message: 'Coach is not accepting clients' }],
    ['coach_not_accepting', 409, { code: 'coach_not_accepting', message: 'Coach is not accepting clients' }],
  ])('%s', async (_name, status, data) => {
    await writePendingInviteCode('GP-FULL');
    (authApi.attachInviteCode as jest.Mock).mockRejectedValueOnce({ response: { status, data } });
    const result = await claimPendingInviteCode();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('coach_not_accepting_clients');
    expect(result.message).toBe(NOT_ACCEPTING);
    expect(await readPendingInviteCode()).toBeNull();
  });
});
