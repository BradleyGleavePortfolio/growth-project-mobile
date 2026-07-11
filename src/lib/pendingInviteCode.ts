/**
 * Pending invite-code reader / claimer.
 *
 * Sprint B5 / B6: a signed-in user landing on an invite link (cold-start
 * deep link, deferred install, or in-app foreground event) used to have
 * the code stored in AsyncStorage and then dropped — no surface ever read
 * it back. This module is the single source of truth for:
 *
 *   - stashing a code from a `/join/<code>` deep link
 *     (`stashInviteCodeFromDeepLink`) — called by RootNavigator
 *   - writing the pending code (`writePendingInviteCode`) — used by the
 *     Day-1 pairing retry path
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
import { prefsStorage } from '../storage/mmkv';
import { authApi } from '../services/api';

// R15/R20: exactly one canonical, user-scoped key for the pending invite code.
// The deep-link handler used to write `pending_invite_code:<scope>` while this
// module read the bare `pending_invite_code`, so the banner never saw the code.
// Both the reader and every writer now derive the key from the same resolved
// scope, so they are always symmetric and always namespaced to the signed-in
// user.
const KEY_PREFIX = 'pending_invite_code:';
const ANONYMOUS_SCOPE = 'anonymous';

// Pre-R15 unscoped key. Older builds (and the now-deleted inline writers) wrote
// the bare form; `readPendingInviteCode` migrates it into the scoped key on the
// first read, then deletes it. This is safe because signOut wipes the legacy
// key, so any value found here can only be the current signed-in user's own
// pre-upgrade code — never a bystander's.
const LEGACY_KEY = 'pending_invite_code';

// Canonical identity store. `userCache` persists the authenticated user to MMKV
// `auth.user_data` and DELETES the legacy AsyncStorage `user_data` copy once its
// boot migration runs (userCache.ts). Reading identity from AsyncStorage alone
// therefore collapses every signed-in user to `anonymous` in production — the
// exact R15/R20 defect this resolver avoids. We read MMKV first (via the
// shim-safe async accessor so it works on both native MMKV and the Expo Go /
// Jest AsyncStorage shim), then fall back to the AsyncStorage key that only
// exists in the brief window after a fresh login and before that migration.
// This mirrors authActions.resolveSigningOutUserId and yields the same real id
// regardless of migration state, so the writer and reader can never resolve
// different scopes across the login/boot boundary.
const MMKV_USER_KEY = 'auth.user_data';

function parseUserId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    if (parsed && typeof parsed.id === 'string' && parsed.id) return parsed.id;
  } catch {
    // Unparseable payload — treat as no identity.
  }
  return null;
}

async function resolveScope(): Promise<string> {
  try {
    const id = parseUserId(await prefsStorage.getStringAsync(MMKV_USER_KEY));
    if (id) return id;
  } catch {
    // MMKV read failed — fall through to the legacy AsyncStorage window.
  }
  try {
    const id = parseUserId(await AsyncStorage.getItem('user_data'));
    if (id) return id;
  } catch {
    // user_data unreadable — fall through to the anonymous scope.
  }
  return ANONYMOUS_SCOPE;
}

function keyForScope(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

export async function readPendingInviteCode(): Promise<string | null> {
  try {
    const scope = await resolveScope();
    const key = keyForScope(scope);
    let raw = await AsyncStorage.getItem(key);
    // Migrate a pre-R15 unscoped code into this user's scope. Guarded to a real
    // user id: migrating under `anonymous` would strand the code at
    // `pending_invite_code:anonymous`, where the real-id reader (post-identity-
    // resolution) could never recover it. Leaving it on the legacy key keeps it
    // recoverable on the next read once identity resolves.
    if (!raw && scope !== ANONYMOUS_SCOPE) {
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
    await AsyncStorage.setItem(keyForScope(await resolveScope()), code);
  } catch {
    // best-effort; the deep-link handler logs its own errors.
  }
}

export async function clearPendingInviteCode(): Promise<void> {
  try {
    // Drop both the scoped key and any stale legacy key so a claim fully clears.
    await AsyncStorage.removeMany([keyForScope(await resolveScope()), LEGACY_KEY]);
  } catch {
    // best-effort
  }
}

// Deep-link entry point. Extracted from RootNavigator so the exact parse →
// write path the navigator runs is unit-testable end-to-end against the reader
// (the original orphan bug — writer and reader on different keys — surfaces as a
// failing test here). Returns the stashed code, or null when the URL carries no
// `/join/<code>` segment.
const JOIN_CODE_RE = /\/join\/([^/?#]+)/i;

export async function stashInviteCodeFromDeepLink(
  url: string,
): Promise<string | null> {
  const code = url.match(JOIN_CODE_RE)?.[1]?.trim();
  if (!code) return null;
  await writePendingInviteCode(code);
  return code;
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
