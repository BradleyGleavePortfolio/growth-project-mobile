/**
 * Which of four kinds of logs the client shares with their coach (Settings >
 * Privacy > Coach sharing). GET /consent/me (+ owner_access on newer
 * backends); POST /consent/grant | /consent/revoke { coach_id, scope }.
 */
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
  /** Coach is the owner account (sees logs without sharing). null: not reported (current production). */
  ownerAccess: boolean | null;
}

export type CoachSharingRead = { kind: 'ok'; state: CoachSharingState } | { kind: 'no_coach' } | { kind: 'error' };

type Row = { scope?: unknown; granted?: unknown };

export function parseCoachSharing(body: unknown): CoachSharingState | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { coach_id?: unknown; consents?: unknown; owner_access?: unknown };
  if (typeof b.coach_id !== 'string' || !Array.isArray(b.consents)) return null;
  const rows: Row[] = b.consents.filter((r): r is Row => !!r && typeof r === 'object');
  const shared = {} as Record<CoachSharingScope, boolean>;
  for (const scope of COACH_SHARING_SCOPES) {
    shared[scope] = rows.find((r) => r.scope === scope)?.granted === true;
  }
  const ownerAccess = typeof b.owner_access === 'boolean' ? b.owner_access : null;
  return { coachId: b.coach_id, shared, ownerAccess };
}

/** The server uses the client's primary coach (400 when there is none). */
export async function readCoachSharing(): Promise<CoachSharingRead> {
  try {
    const res = await api.get<unknown>('/consent/me');
    const state = parseCoachSharing(res?.data);
    return state ? { kind: 'ok', state } : { kind: 'error' };
  } catch (err) {
    const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
    if (status === 400) return { kind: 'no_coach' };
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

/**
 * First-sign-in coach sharing (B-SHARE-GUEST-127). An account linked outside
 * the app (a share-link buyer: the web checkout creates the account and links
 * the coach) never saw the join sentence. GET /consent/coach-sharing-notice
 * says whether the first onboarding screen prints it and names the coach;
 * POST records the four shares when the client taps on under it. Production
 * without that route answers 404: nothing is shown or sent.
 */
export interface FirstSignInSharing {
  version: string;
  coachName: string | null;
}

export function parseFirstSignInSharing(body: unknown, version: string): FirstSignInSharing | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { applies?: unknown; notice_version?: unknown; coach_name?: unknown };
  if (b.applies !== true || b.notice_version !== version) return null;
  const name = typeof b.coach_name === 'string' ? b.coach_name.trim() : '';
  return { version, coachName: name || null };
}

export async function readFirstSignInSharing(version: string): Promise<FirstSignInSharing | null> {
  try {
    const res = await api.get<unknown>('/consent/coach-sharing-notice');
    return parseFirstSignInSharing(res?.data, version);
  } catch (err) {
    const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
    if (status !== 404) logger.warn('coachSharingApi', 'GET /consent/coach-sharing-notice failed', err);
    return null;
  }
}

export async function acceptFirstSignInSharing(version: string): Promise<boolean> {
  try {
    const res = await api.post<unknown>('/consent/coach-sharing-notice', { coach_sharing_notice: version });
    const data = res?.data as { coach_sharing_granted?: unknown } | undefined;
    return data?.coach_sharing_granted === true;
  } catch (err) {
    logger.warn('coachSharingApi', 'POST /consent/coach-sharing-notice failed', err);
    return false;
  }
}
