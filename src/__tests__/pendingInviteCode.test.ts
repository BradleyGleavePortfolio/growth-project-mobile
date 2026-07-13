/**
 * B5/B6 / A3 pairing — the pending invite code is a single, user-scoped source
 * of truth. The deep-link handler stashes and the home banner reads through the
 * same helper and the same scope resolution, so a code that lands while signed
 * in always reaches the attach banner, never leaks across users, and survives
 * the boot/login identity migration.
 *
 * Identity note: production persists the user to MMKV `auth.user_data` and
 * DELETES the legacy AsyncStorage `user_data` copy (userCache.readUserCache).
 * These tests exercise that real layout via `setUserCache` / `readUserCache`
 * so scope resolution is proven against production state, not a fixture that
 * cannot occur at runtime.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  claimPendingInviteCode,
  clearPendingInviteCode,
  readPendingInviteCode,
  stashInviteCodeFromDeepLink,
  writePendingInviteCode,
} from '../lib/pendingInviteCode';
import { setUserCache, readUserCache, clearUserCache } from '../lib/userCache';
import { logger } from '../utils/logger';

jest.mock('../services/api', () => ({
  authApi: {
    attachInviteCode: jest.fn(),
  },
}));

// Lazy access to the mock so each test can configure its own resolution.
import { authApi } from '../services/api';

const LEGACY_KEY = 'pending_invite_code';
const AS_USER_KEY = 'user_data';
const scopedKey = (scope: string) => `pending_invite_code:${scope}`;

/** Production steady state: identity in MMKV, AsyncStorage `user_data` gone. */
function signedInSteadyState(id: string): void {
  setUserCache({ id, email: `${id}@example.com` });
}

/** Fresh-login window: identity only in AsyncStorage, MMKV not yet populated. */
async function freshLoginBeforeMigration(id: string): Promise<void> {
  await AsyncStorage.setItem(AS_USER_KEY, JSON.stringify({ id }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  clearUserCache();
  (authApi.attachInviteCode as jest.Mock).mockReset();
});

describe('scope resolution — canonical MMKV identity (P2 root fix)', () => {
  it('namespaces to the real user id from MMKV even when AsyncStorage user_data is absent', async () => {
    // Exactly the production layout: MMKV populated, no AsyncStorage user_data.
    signedInSteadyState('user-123');
    expect(await AsyncStorage.getItem(AS_USER_KEY)).toBeNull();

    await writePendingInviteCode('ABC123');

    // The physical key is the real user id — NOT `pending_invite_code:anonymous`.
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('ABC123');
    expect(await AsyncStorage.getItem(scopedKey('anonymous'))).toBeNull();
    expect(await readPendingInviteCode()).toBe('ABC123');
  });

  it('survives the boot migration: write pre-migration, read post-migration, same real scope (P3 race)', async () => {
    // Fresh login — id only in AsyncStorage, MMKV empty.
    await freshLoginBeforeMigration('user-123');
    await stashInviteCodeFromDeepLink('tgp://join/RACE-CODE');
    // Written under the real id (resolved from the AsyncStorage fallback).
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('RACE-CODE');

    // The real userCache boot migration runs: value moves to MMKV and the
    // AsyncStorage user_data copy is deleted.
    await readUserCache();
    expect(await AsyncStorage.getItem(AS_USER_KEY)).toBeNull();

    // The banner reads AFTER migration — old AsyncStorage-only resolver would
    // now collapse to `anonymous` and orphan the code. The MMKV-first resolver
    // still finds the same scope.
    expect(await readPendingInviteCode()).toBe('RACE-CODE');
  });

  it('prefers MMKV identity over a stale AsyncStorage user_data value', async () => {
    // A stale AsyncStorage id must not win over the canonical MMKV id.
    signedInSteadyState('mmkv-user');
    await AsyncStorage.setItem(AS_USER_KEY, JSON.stringify({ id: 'stale-user' }));

    await writePendingInviteCode('CODE');
    expect(await AsyncStorage.getItem(scopedKey('mmkv-user'))).toBe('CODE');
    expect(await AsyncStorage.getItem(scopedKey('stale-user'))).toBeNull();
  });

  it('writes nothing and reads null when no identity resolves anywhere (no anonymous shared slot)', async () => {
    // R15/R92: with no resolvable identity a write must NOT persist to any
    // shared slot, or the next signed-in user on the device would inherit it.
    await writePendingInviteCode('ANON-CODE');
    expect(await AsyncStorage.getItem(scopedKey('anonymous'))).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(await readPendingInviteCode()).toBeNull();

    // Once identity resolves, a fresh write is scoped to the real user id.
    signedInSteadyState('user-123');
    await writePendingInviteCode('REAL-CODE');
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('REAL-CODE');
    expect(await AsyncStorage.getItem(scopedKey('anonymous'))).toBeNull();
    expect(await readPendingInviteCode()).toBe('REAL-CODE');
  });

  it('logs and no-ops a write when identity is unresolvable (observable, not silent)', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await writePendingInviteCode('DROP-ME');
    expect(warn).toHaveBeenCalled();
    // The dropped code is never logged (PII): no argument equals the code.
    for (const call of warn.mock.calls) {
      expect(call).not.toContain('DROP-ME');
    }
    warn.mockRestore();
  });
});

describe('deep-link stash path (production wiring — original orphan bug guard)', () => {
  it('parses /join/<code> and round-trips through the reader the banner uses', async () => {
    signedInSteadyState('user-123');
    const stashed = await stashInviteCodeFromDeepLink(
      'https://app.trygrowthproject.com/join/GROWTH-1',
    );
    expect(stashed).toBe('GROWTH-1');
    // End-to-end: the reader (PendingInviteBanner's source) sees the code. If
    // the writer and reader keys ever diverge again, this returns null.
    expect(await readPendingInviteCode()).toBe('GROWTH-1');
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('GROWTH-1');
  });

  it('handles the tgp:// scheme and trims/query-strips the code', async () => {
    signedInSteadyState('user-123');
    const stashed = await stashInviteCodeFromDeepLink('tgp://join/ABC123?ref=email');
    expect(stashed).toBe('ABC123');
    expect(await readPendingInviteCode()).toBe('ABC123');
  });

  it('returns null and writes nothing for a URL with no /join/ segment', async () => {
    signedInSteadyState('user-123');
    const stashed = await stashInviteCodeFromDeepLink('tgp://reset-password/xyz');
    expect(stashed).toBeNull();
    expect(await readPendingInviteCode()).toBeNull();
  });
});

describe('cross-user isolation (R15) — no anonymous shared slot', () => {
  it('does not surface user A\'s code when user B is signed in (account switch without signOut)', async () => {
    signedInSteadyState('userA');
    await writePendingInviteCode('A-ONLY');
    expect(await readPendingInviteCode()).toBe('A-ONLY');

    // A second user signs in on the same device (A never signed out).
    signedInSteadyState('userB');
    expect(await readPendingInviteCode()).toBeNull();

    // Back to A — their code is still theirs alone.
    signedInSteadyState('userA');
    expect(await readPendingInviteCode()).toBe('A-ONLY');
  });

  it('scopes writes per real user id so two users never share one slot', async () => {
    signedInSteadyState('userA');
    await writePendingInviteCode('CODE-A');
    signedInSteadyState('userB');
    await writePendingInviteCode('CODE-B');

    expect(await AsyncStorage.getItem(scopedKey('userA'))).toBe('CODE-A');
    expect(await AsyncStorage.getItem(scopedKey('userB'))).toBe('CODE-B');
    expect(await AsyncStorage.getItem(scopedKey('anonymous'))).toBeNull();
    expect(await readPendingInviteCode()).toBe('CODE-B');
  });
});

describe('legacy migration off the unscoped key — no anonymous stranding', () => {
  it('migrates a pre-R15 unscoped code into the current user scope on read', async () => {
    signedInSteadyState('user-123');
    await AsyncStorage.setItem(LEGACY_KEY, 'LEGACY-CODE');

    expect(await readPendingInviteCode()).toBe('LEGACY-CODE');
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('LEGACY-CODE');
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('does NOT migrate a legacy code into the anonymous scope (keeps it recoverable)', async () => {
    // No identity resolves yet — reading must not strand the legacy code at
    // `pending_invite_code:anonymous` where the real-id reader can't find it.
    await AsyncStorage.setItem(LEGACY_KEY, 'LEGACY-CODE');
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(scopedKey('anonymous'))).toBeNull();
    // The legacy value is untouched, so it migrates once identity arrives.
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBe('LEGACY-CODE');

    signedInSteadyState('user-123');
    expect(await readPendingInviteCode()).toBe('LEGACY-CODE');
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('LEGACY-CODE');
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('prefers the scoped value over a stale legacy value', async () => {
    signedInSteadyState('user-123');
    await AsyncStorage.setItem(scopedKey('user-123'), 'FRESH');
    await AsyncStorage.setItem(LEGACY_KEY, 'STALE');
    expect(await readPendingInviteCode()).toBe('FRESH');
    // The scoped value wins and the legacy key is left untouched by the read.
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBe('STALE');
  });

  it('does not migrate a whitespace-only legacy value', async () => {
    signedInSteadyState('user-123');
    await AsyncStorage.setItem(LEGACY_KEY, '   ');
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
  });
});

describe('read/write/clear round-trip and edge cases', () => {
  it('round-trips write → read → clear for a signed-in user', async () => {
    signedInSteadyState('user-123');
    await writePendingInviteCode('GROWTH-1');
    expect(await readPendingInviteCode()).toBe('GROWTH-1');
    await clearPendingInviteCode();
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
  });

  it('treats a whitespace-only scoped value as missing', async () => {
    signedInSteadyState('user-123');
    await AsyncStorage.setItem(scopedKey('user-123'), '   ');
    expect(await readPendingInviteCode()).toBeNull();
  });

  it('clear() removes both the scoped key and any stale legacy key', async () => {
    signedInSteadyState('user-123');
    await AsyncStorage.setItem(scopedKey('user-123'), 'SCOPED');
    await AsyncStorage.setItem(LEGACY_KEY, 'LEGACY');
    await clearPendingInviteCode();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('degrades to null when AsyncStorage.getItem throws', async () => {
    signedInSteadyState('user-123');
    const spy = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await readPendingInviteCode()).toBeNull();
    spy.mockRestore();
  });

  it('write swallows storage failures (best-effort)', async () => {
    signedInSteadyState('user-123');
    const spy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('storage full'));
    await expect(writePendingInviteCode('ABC')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('claim flow', () => {
  it('claims via authApi.attachInviteCode and clears the scoped key on success', async () => {
    signedInSteadyState('user-123');
    await writePendingInviteCode('GROWTH-1');
    (authApi.attachInviteCode as jest.Mock).mockResolvedValueOnce({ data: {} });

    const result = await claimPendingInviteCode();
    expect(result.ok).toBe(true);
    expect(authApi.attachInviteCode).toHaveBeenCalledWith('GROWTH-1');
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
  });

  it('clears storage on 4xx (permanent failure) but keeps it on 5xx', async () => {
    signedInSteadyState('user-123');

    await writePendingInviteCode('BAD');
    (authApi.attachInviteCode as jest.Mock).mockRejectedValueOnce({
      response: { status: 410, data: { reason: 'expired', message: 'Code expired.' } },
    });
    const bad = await claimPendingInviteCode();
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('expired');
    expect(bad.message).toBe('Code expired.');
    expect(await readPendingInviteCode()).toBeNull();

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
    signedInSteadyState('user-123');
    (authApi.attachInviteCode as jest.Mock).mockResolvedValueOnce({ data: {} });
    const result = await claimPendingInviteCode('DIRECT-CODE');
    expect(result.ok).toBe(true);
    expect(authApi.attachInviteCode).toHaveBeenCalledWith('DIRECT-CODE');
  });

  it('refuses to claim when there is no code', async () => {
    signedInSteadyState('user-123');
    const r = await claimPendingInviteCode();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing');
    expect(authApi.attachInviteCode).not.toHaveBeenCalled();
  });
});
