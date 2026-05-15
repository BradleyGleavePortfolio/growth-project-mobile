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
    expect(authApi.attachInviteCode).toHaveBeenCalledWith('GROWTH-1');
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
