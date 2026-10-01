/**
 * The "role selection is not finished" gate, scoped to the account it belongs
 * to (#306 fix round 5, Sol B-306-2 / Opus B-306-1).
 *
 * `needs_role_selection = 'true'` keeps RootNavigator on the auth stack
 * (RootNavigator.bootstrapAuth) so a signup that has not finished
 * RoleSelection cannot enter the app on a cold start. The flag itself is
 * device-wide, so this module records whose it is
 * (`needs_role_selection_owner` = server user id) and every Login sign-in
 * settles it for the account that just signed in:
 *  - a coach-like account never needs role selection: the gate is cleared;
 *  - the gate belongs to this account (or to nobody, written by an older
 *    build): RoleSelection finishes the step instead of a bare
 *    `authEvents.emit()`, which RootNavigator would ignore while the flag is
 *    set (the strand both round-4 audits reproduced);
 *  - the gate belongs to another account: it is stale for this sign-in and is
 *    cleared, so another account never inherits it.
 *
 * The Login "coach sign-up was not applied" recovery screen holds the gate
 * while it is shown. What it holds is recorded separately
 * (`signup_coach_recovery_gate`): the account, the sign-in, and whether that
 * account genuinely needed role selection before the notice. That original
 * requirement is captured once and never re-read from a flag this flow wrote,
 * so acknowledging the notice releases only what the recovery added.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoachSignupMethod } from './coachSignupAttempt';

export const NEEDS_ROLE_SELECTION_KEY = 'needs_role_selection';
export const ROLE_SELECTION_OWNER_KEY = 'needs_role_selection_owner';
export const COACH_RECOVERY_GATE_KEY = 'signup_coach_recovery_gate';

const COACH_LIKE_ROLES: readonly string[] = ['coach', 'sub_coach', 'owner'];

/** Roles that never pass through client role selection. */
export function isCoachLikeRole(role: unknown): boolean {
  return typeof role === 'string' && COACH_LIKE_ROLES.includes(role);
}

/** Server user id of a sign-in answer, if it has one. */
export function userIdOf(user: { id?: unknown } | null | undefined): string | null {
  const id = user?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

async function safeGet(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Role selection is pending for this account (the gate is set and owned by it). */
export async function markRoleSelectionPending(userId: string | null | undefined): Promise<void> {
  await AsyncStorage.setItem(NEEDS_ROLE_SELECTION_KEY, 'true');
  try {
    if (userId) await AsyncStorage.setItem(ROLE_SELECTION_OWNER_KEY, userId);
    else await AsyncStorage.removeItem(ROLE_SELECTION_OWNER_KEY);
  } catch {
    // An unknown owner is treated like an older build's flag (see below).
  }
}

export async function clearRoleSelectionPending(): Promise<void> {
  await AsyncStorage.removeItem(NEEDS_ROLE_SELECTION_KEY);
  try {
    await AsyncStorage.removeItem(ROLE_SELECTION_OWNER_KEY);
  } catch {
    // ignore
  }
}

/**
 * True when the gate is set and belongs to this account. A flag with no
 * recorded owner (written before this round) counts as this account's, so a
 * genuinely unfinished signup is finished rather than skipped; RoleSelection
 * lets an account that already has a coach straight through.
 */
export async function isRoleSelectionPendingFor(userId: string | null | undefined): Promise<boolean> {
  if ((await safeGet(NEEDS_ROLE_SELECTION_KEY)) !== 'true') return false;
  const owner = await safeGet(ROLE_SELECTION_OWNER_KEY);
  if (!owner) return true;
  return !!userId && owner === userId;
}

/**
 * Settle the gate for an existing account that just signed in on Login.
 * Returns where the caller goes next: 'role-selection' (finish the step) or
 * 'app' (`authEvents.emit()`; the gate is clear, so RootNavigator proceeds).
 */
export async function settleRoleSelectionGateForSignIn(
  user: { id?: unknown; role?: unknown } | null | undefined,
): Promise<'role-selection' | 'app'> {
  if (isCoachLikeRole(user?.role)) {
    await clearRoleSelectionPending();
    return 'app';
  }
  if (await isRoleSelectionPendingFor(userIdOf(user))) return 'role-selection';
  if ((await safeGet(NEEDS_ROLE_SELECTION_KEY)) === 'true') await clearRoleSelectionPending();
  return 'app';
}

export interface CoachRecoveryGate {
  userId: string;
  method: CoachSignupMethod;
  identity?: string;
  /** #306 r6: stable provider subject of the sign-in (Apple / Google), when known. */
  subject?: string;
  /** Whether this account needed role selection before the notice was shown. */
  priorPending: boolean;
  at: number;
}

export async function readCoachRecoveryGate(): Promise<CoachRecoveryGate | null> {
  const raw = await safeGet(COACH_RECOVERY_GATE_KEY);
  if (!raw) return null;
  try {
    const g = JSON.parse(raw) as Partial<CoachRecoveryGate> | null;
    if (!g || typeof g.userId !== 'string' || !g.userId) return null;
    if (g.method !== 'email' && g.method !== 'apple' && g.method !== 'google') return null;
    return {
      userId: g.userId,
      method: g.method,
      ...(typeof g.identity === 'string' && g.identity ? { identity: g.identity } : {}),
      ...(typeof g.subject === 'string' && g.subject ? { subject: g.subject } : {}),
      priorPending: g.priorPending === true,
      at: typeof g.at === 'number' ? g.at : 0,
    };
  } catch {
    return null;
  }
}

export async function writeCoachRecoveryGate(gate: CoachRecoveryGate): Promise<void> {
  try {
    await AsyncStorage.setItem(COACH_RECOVERY_GATE_KEY, JSON.stringify(gate));
  } catch {
    // Best effort: the notice is still shown for this sign-in.
  }
}

export async function clearCoachRecoveryGate(): Promise<void> {
  try {
    await AsyncStorage.removeItem(COACH_RECOVERY_GATE_KEY);
  } catch {
    // ignore
  }
}
