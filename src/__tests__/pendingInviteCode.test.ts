/**
 * B5/B6 / A3 pairing — the pending invite code is a single, user-scoped source
 * of truth. The deep-link handler writes and the home banner reads through the
 * same helper, so a code that lands while signed in always reaches the attach
 * banner, never leaks across users, and migrates cleanly off the pre-R15 key.
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

const LEGACY_KEY = 'pending_invite_code';
const scopedKey = (scope: string) => `pending_invite_code:${scope}`;

async function signIn(id: string): Promise<void> {
  await AsyncStorage.setItem('user_data', JSON.stringify({ id }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  (authApi.attachInviteCode as jest.Mock).mockReset();
});

describe('pending invite code — canonical user-scoped key', () => {
  it('writes under the signed-in user id and reads it back (deep-link → banner)', async () => {
    await signIn('user-123');
    await writePendingInviteCode('ABC123');

    // The physical key is namespaced to the user, not the bare legacy key.
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('ABC123');
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await readPendingInviteCode()).toBe('ABC123');
  });

  it('falls back to the anonymous scope when there is no signed-in user', async () => {
    await writePendingInviteCode('ANON-CODE');
    expect(await AsyncStorage.getItem(scopedKey('anonymous'))).toBe('ANON-CODE');
    expect(await readPendingInviteCode()).toBe('ANON-CODE');
  });

  it('returns null when nothing has been stashed for the current scope', async () => {
    await signIn('user-123');
    expect(await readPendingInviteCode()).toBeNull();
  });

  it('round-trips write → read → clear for a signed-in user', async () => {
    await signIn('user-123');
    await writePendingInviteCode('GROWTH-1');
    expect(await readPendingInviteCode()).toBe('GROWTH-1');
    await clearPendingInviteCode();
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
  });

  it('treats a whitespace-only scoped value as missing', async () => {
    await signIn('user-123');
    await AsyncStorage.setItem(scopedKey('user-123'), '   ');
    expect(await readPendingInviteCode()).toBeNull();
  });
});

describe('pending invite code — cross-user isolation (R15)', () => {
  it('does not surface user A\'s code when user B is signed in', async () => {
    await signIn('userA');
    await writePendingInviteCode('A-ONLY');
    expect(await readPendingInviteCode()).toBe('A-ONLY');

    // A second user signs in on the same device (A never signed out).
    await signIn('userB');
    expect(await readPendingInviteCode()).toBeNull();

    // Back to A — their code is still theirs alone.
    await signIn('userA');
    expect(await readPendingInviteCode()).toBe('A-ONLY');
  });

  it('scopes writes per user so two users never share one code slot', async () => {
    await signIn('userA');
    await writePendingInviteCode('CODE-A');
    await signIn('userB');
    await writePendingInviteCode('CODE-B');

    expect(await AsyncStorage.getItem(scopedKey('userA'))).toBe('CODE-A');
    expect(await AsyncStorage.getItem(scopedKey('userB'))).toBe('CODE-B');
    expect(await readPendingInviteCode()).toBe('CODE-B');
  });
});

describe('pending invite code — legacy migration off the unscoped key', () => {
  it('migrates a pre-R15 unscoped code into the current user scope on read', async () => {
    await signIn('user-123');
    // Simulate an upgrading user whose code sits at the old bare key.
    await AsyncStorage.setItem(LEGACY_KEY, 'LEGACY-CODE');

    expect(await readPendingInviteCode()).toBe('LEGACY-CODE');
    // The value moved into the scoped key and the legacy key is gone.
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('LEGACY-CODE');
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('prefers the scoped value over a stale legacy value', async () => {
    await signIn('user-123');
    await AsyncStorage.setItem(scopedKey('user-123'), 'FRESH');
    await AsyncStorage.setItem(LEGACY_KEY, 'STALE');
    expect(await readPendingInviteCode()).toBe('FRESH');
    // The scoped value wins and the legacy key is left untouched by the read.
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBe('STALE');
  });

  it('does not migrate a whitespace-only legacy value', async () => {
    await signIn('user-123');
    await AsyncStorage.setItem(LEGACY_KEY, '   ');
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
  });

  it('clear() removes both the scoped key and any stale legacy key', async () => {
    await signIn('user-123');
    await AsyncStorage.setItem(scopedKey('user-123'), 'SCOPED');
    await AsyncStorage.setItem(LEGACY_KEY, 'LEGACY');
    await clearPendingInviteCode();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe('pending invite code — claim flow', () => {
  it('claims via authApi.attachInviteCode and clears the scoped key on success', async () => {
    await signIn('user-123');
    await writePendingInviteCode('GROWTH-1');
    (authApi.attachInviteCode as jest.Mock).mockResolvedValueOnce({ data: {} });

    const result = await claimPendingInviteCode();
    expect(result.ok).toBe(true);
    expect(authApi.attachInviteCode).toHaveBeenCalledWith('GROWTH-1');
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
  });

  it('clears storage on 4xx (permanent failure) but keeps it on 5xx', async () => {
    await signIn('user-123');

    // Permanent failure → surface the server reason and clear the code.
    await writePendingInviteCode('BAD');
    (authApi.attachInviteCode as jest.Mock).mockRejectedValueOnce({
      response: { status: 410, data: { reason: 'expired', message: 'Code expired.' } },
    });
    const bad = await claimPendingInviteCode();
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('expired');
    expect(bad.message).toBe('Code expired.');
    expect(await readPendingInviteCode()).toBeNull();

    // Transient failure → keep the code so the user can retry from the banner.
    await writePendingInviteCode('LATER');
    (authApi.attachInviteCode as jest.Mock).mockRejectedValueOnce({
      response: { status: 503 },
    });
    const transient = await claimPendingInviteCode();
    expect(transient.ok).toBe(false);
    expect(transient.reason).toBe('http_503');
    expect(await readPendingInviteCode()).toBe('LATER');
  });

  it('claims an explicitly passed code even when nothing is stashed', async () => {
    await signIn('user-123');
    (authApi.attachInviteCode as jest.Mock).mockResolvedValueOnce({ data: {} });
    const result = await claimPendingInviteCode('DIRECT-CODE');
    expect(result.ok).toBe(true);
    expect(authApi.attachInviteCode).toHaveBeenCalledWith('DIRECT-CODE');
  });

  it('refuses to claim when there is no code', async () => {
    await signIn('user-123');
    const r = await claimPendingInviteCode();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing');
    expect(authApi.attachInviteCode).not.toHaveBeenCalled();
  });
});
