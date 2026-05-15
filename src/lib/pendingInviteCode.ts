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

const KEY = 'pending_invite_code';

export async function readPendingInviteCode(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function writePendingInviteCode(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // best-effort; the deep-link handler logs its own errors.
  }
}

export async function clearPendingInviteCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
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
