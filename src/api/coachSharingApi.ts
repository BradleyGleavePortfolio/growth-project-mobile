/**
 * coachSharingApi — the client's own choice to share four kinds of logs with
 * their coach (B-SHARE-126). Backend: src/consent.
 *   GET  /consent/me[?coach_id=]  every scope's state (+ owner_access on newer backends)
 *   POST /consent/grant | /consent/revoke  { coach_id, scope }  (idempotent)
 * "No row" means not shared. Nothing here shares by default. Works against
 * the current production backend: owner_access absent reads as false.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import { logger } from '../utils/logger';

export const COACH_SHARING_SCOPES = ['fitness.workouts', 'fitness.food_macros', 'fitness.body_metrics', 'fitness.habits_progress'] as const;
export type CoachSharingScope = (typeof COACH_SHARING_SCOPES)[number];

export const COACH_SHARING_LABELS: Record<CoachSharingScope, string> = {
  'fitness.workouts': 'Workouts',
  'fitness.food_macros': 'Food logs',
  'fitness.body_metrics': 'Weigh-ins',
  'fitness.habits_progress': 'Check-ins and habits',
};

export interface CoachSharingState {
  coachId: string;
  shared: Record<CoachSharingScope, boolean>;
  /** At least one of the four has a saved choice (shared or turned off). */
  decided: boolean;
  /** The coach account is the platform owner account, which sees client logs without sharing. */
  ownerAccess: boolean;
}

export type CoachSharingRead = { kind: 'ok'; state: CoachSharingState } | { kind: 'no_coach' } | { kind: 'error' };

type Row = { scope?: unknown; granted?: unknown; granted_at?: unknown; revoked_at?: unknown };

export function parseCoachSharing(body: unknown): CoachSharingState | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { coach_id?: unknown; consents?: unknown; owner_access?: unknown };
  if (typeof b.coach_id !== 'string' || !Array.isArray(b.consents)) return null;
  const rows: Row[] = b.consents.filter((r): r is Row => !!r && typeof r === 'object');
  const shared = {} as Record<CoachSharingScope, boolean>;
  let decided = false;
  for (const scope of COACH_SHARING_SCOPES) {
    const row = rows.find((r) => r.scope === scope);
    shared[scope] = row?.granted === true;
    if (row && (row.granted_at != null || row.revoked_at != null)) decided = true;
  }
  return { coachId: b.coach_id, shared, decided, ownerAccess: b.owner_access === true };
}

/** Without `coachId` the server uses the client's primary coach (400 when there is none). */
export async function readCoachSharing(coachId?: string | null): Promise<CoachSharingRead> {
  try {
    const res = await api.get<unknown>('/consent/me', coachId ? { params: { coach_id: coachId } } : undefined);
    const state = parseCoachSharing(res?.data);
    return state ? { kind: 'ok', state } : { kind: 'error' };
  } catch (err) {
    const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
    if (!coachId && status === 400) return { kind: 'no_coach' };
    logger.warn('coachSharingApi', 'GET /consent/me failed', err);
    return { kind: 'error' };
  }
}

export async function setCoachSharing(coachId: string, scope: CoachSharingScope, on: boolean): Promise<boolean> {
  try {
    await api.post(on ? '/consent/grant' : '/consent/revoke', { coach_id: coachId, scope });
    return true;
  } catch (err) {
    logger.warn('coachSharingApi', `${on ? 'grant' : 'revoke'} ${scope} failed`, err);
    return false;
  }
}

/** Shares all four; a retry after a partial failure is safe (idempotent). */
export async function shareAllWithCoach(coachId: string): Promise<boolean> {
  const results = await Promise.all(COACH_SHARING_SCOPES.map((s) => setCoachSharing(coachId, s, true)));
  return results.every(Boolean);
}

// "Not now": remembered on this device per account and coach.
const notNowKey = (userId: string, coachId: string) => `tgp.coachSharing.notNow.${userId}.${coachId}`;

export async function rememberNotNow(userId: string, coachId: string): Promise<void> {
  await AsyncStorage.setItem(notNowKey(userId, coachId), '1').catch((err: unknown) =>
    logger.warn('coachSharingApi', 'not-now save failed', err),
  );
}

/** The coach to ask about (`coachId`, else the server's primary coach), or null when there is no coach, a
 * choice exists for any of the four, "Not now" was picked here, the coach is the owner account, or a read fails. */
export async function coachToAskAbout(userId: string, coachId?: string | null): Promise<string | null> {
  const read = await readCoachSharing(coachId);
  if (read.kind !== 'ok' || read.state.decided || read.state.ownerAccess) return null;
  const notNow = await AsyncStorage.getItem(notNowKey(userId, read.state.coachId)).catch((err: unknown) => {
    logger.warn('coachSharingApi', 'not-now read failed', err);
    return null;
  });
  return notNow === '1' ? null : read.state.coachId;
}
