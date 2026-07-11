/**
 * Pending invite-code reader / claimer.
 *
 * Sprint B5 / B6: a signed-in user landing on an invite link (cold-start
 * deep link, deferred install, or in-app foreground event) used to have
 * the code stored in AsyncStorage and then dropped — no surface ever read
 * it back. This module is the single source of truth for:
 *
 *   - writing the pending code (`writePendingInviteCode`) — used by the
 *     deep-link handler and the Day-1 pairing retry path
 *   - reading the pending code (`readPendingInviteCode`)
 *   - clearing it after a successful claim (`clearPendingInviteCode`)
 *   - the claim itself (`claimPendingInviteCode`) — POSTs to
 *     /auth/attach-invite-code via authApi.
 *
 * It deliberately does not auto-claim without user consent: claiming
 * silently re-pairs a client to a different coach, which is destructive.
 * Callers (currently HomeScreen via PendingInviteBanner) show a banner
 * with a real consent flow and then call `claimPendingInviteCode`.
 *
 * Note on deferred-install attribution: native install referrers / Branch
 * are NOT wired up in this build. Until they are, the user must open the
 * invite link a second time post-install for the code to be captured.
 * That gap is called out in the README "Placeholders / TODO" table.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../services/api';

// R15/R20: exactly one canonical, user-scoped key for the pending invite code.
// The deep-link handler used to write `pending_invite_code:<scope>` while this
// module read the bare `pending_invite_code`, so the banner never saw the code.
// Both the reader and every writer now derive the key through `scopedKey()`,
// so they are always symmetric and always namespaced to the signed-in user.
const KEY_PREFIX = 'pending_invite_code:';

// Pre-R15 unscoped key. Older builds (and the now-deleted inline writers) wrote
// the bare form; `readPendingInviteCode` migrates it into the scoped key on the
// first read, then deletes it. This is safe because signOut wipes the legacy
// key, so any value found here can only be the current signed-in user's own
// pre-upgrade code — never a bystander's.
const LEGACY_KEY = 'pending_invite_code';

// Resolve the scope suffix. Mirrors the deep-link handler: the authenticated
// user's id from `user_data`, falling back to `anonymous` when it cannot be
// parsed (unauthenticated cold-start). Shared by the reader and all writers so
// the key they touch is identical.
async function resolveScope(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem('user_data');
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string };
      if (parsed && typeof parsed.id === 'string' && parsed.id) return parsed.id;
    }
  } catch {
    // user_data unreadable — fall through to the anonymous scope.
  }
  return 'anonymous';
}

async function scopedKey(): Promise<string> {
  return `${KEY_PREFIX}${await resolveScope()}`;
}

export async function readPendingInviteCode(): Promise<string | null> {
  try {
    const key = await scopedKey();
    let raw = await AsyncStorage.getItem(key);
    if (!raw) {
      // One-time migration of a pre-R15 unscoped code belonging to this user.
      const legacy = await AsyncStorage.getItem(LEGACY_KEY);
      if (legacy && legacy.trim()) {
        await AsyncStorage.setItem(key, legacy);
        await AsyncStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function writePendingInviteCode(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(await scopedKey(), code);
  } catch {
    // best-effort; the deep-link handler logs its own errors.
  }
}

export async function clearPendingInviteCode(): Promise<void> {
  try {
    // Drop both the scoped key and any stale legacy key so a claim fully clears.
    await AsyncStorage.removeMany([await scopedKey(), LEGACY_KEY]);
  } catch {
    // best-effort
  }
}

export interface ClaimResult {
  ok: boolean;
  /** Server-provided reason on failure (e.g. "expired", "max_uses_reached"). */
  reason?: string;
  /** Surface-friendly message when the server provides nothing usable. */
  message?: string;
}

export async function claimPendingInviteCode(
  code?: string | null,
): Promise<ClaimResult> {
  const c = (code ?? (await readPendingInviteCode()))?.trim();
  if (!c) {
    return { ok: false, reason: 'missing', message: 'No invite code to claim.' };
  }
  try {
    await authApi.attachInviteCode(c);
    await clearPendingInviteCode();
    return { ok: true };
  } catch (err: unknown) {
    const r = err as { response?: { status?: number; data?: { reason?: string; message?: string } } };
    const status = r?.response?.status ?? 0;
    const reason = r?.response?.data?.reason;
    const message = r?.response?.data?.message;
    // 4xx → the code is permanently bad; clear so the banner stops nagging.
    if (status >= 400 && status < 500) {
      await clearPendingInviteCode();
    }
    return {
      ok: false,
      reason: reason ?? (status ? `http_${status}` : 'network'),
      message: message ?? 'Could not attach this invite code.',
    };
  }
}
