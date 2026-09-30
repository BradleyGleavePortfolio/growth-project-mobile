/**
 * Pending invite-code reader / claimer.
 *
 * Sprint B5 / B6: a signed-in user landing on an invite link (cold-start
 * deep link, deferred install, or in-app foreground event) used to have
 * the code stored in AsyncStorage and then dropped — no surface ever read
 * it back. This module is the single source of truth for:
 *
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
import { readUserCache } from './userCache';

const KEY = 'pending_invite_code';
/** Legacy scoped keys written by older builds: `pending_invite_code:<userId|anonymous>`. */
const legacyKey = (scope: string) => `${KEY}:${scope}`;

// Audit B2: change notification so an already-mounted PendingInviteBanner
// repaints when a foreground invite link writes a code (no auth reboot).
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribePendingInviteCode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      // a listener must not break the writer
    }
  }
}

function clean(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  return trimmed ? trimmed : null;
}

/**
 * Audit B1: one-time migration of the old scoped keys. Only the CURRENT
 * user's key (from readUserCache) and the pre-login `anonymous` key are
 * migrated. Another user's scoped key is never read. An anonymous code was
 * captured on this device before sign-in, which is the same meaning as the
 * bare key, and claiming it still goes through the banner's consent step.
 * A newer canonical value always wins. The legacy key is deleted only after
 * the canonical write succeeded.
 */
async function migrateLegacyPendingCode(): Promise<string | null> {
  let userId: string | null = null;
  try {
    const u = await readUserCache();
    userId = typeof u?.id === 'string' && u.id.trim() ? u.id : null;
  } catch {
    userId = null;
  }
  const scopes = userId ? [userId, 'anonymous'] : ['anonymous'];
  for (const scope of scopes) {
    let legacy: string | null = null;
    try {
      legacy = clean(await AsyncStorage.getItem(legacyKey(scope)));
    } catch {
      legacy = null;
    }
    if (!legacy) continue;
    try {
      await AsyncStorage.setItem(KEY, legacy);
    } catch {
      return legacy; // show it this time; keep the legacy key for the next read
    }
    try {
      await AsyncStorage.removeItem(legacyKey(scope));
    } catch {
      // canonical copy exists; a leftover legacy key is harmless
    }
    return legacy;
  }
  return null;
}

/**
 * Code from a signed-in invite URL: `https://<host>/join/<code>` or
 * `tgp://join/<code>`. Returns the raw path segment (the server validates).
 */
export function extractJoinPathCode(url: string): string | null {
  const match = url.match(/\/join\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

export async function readPendingInviteCode(): Promise<string | null> {
  try {
    const canonical = clean(await AsyncStorage.getItem(KEY));
    if (canonical) return canonical;
  } catch {
    return null;
  }
  return migrateLegacyPendingCode();
}

export async function writePendingInviteCode(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // best-effort; the deep-link handler logs its own errors.
    return;
  }
  notify();
}

export async function clearPendingInviteCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort
    return;
  }
  notify();
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
