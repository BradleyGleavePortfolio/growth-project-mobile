/**
 * Coach sharing (Settings > Privacy > Coach sharing, Trust & Privacy).
 * Workouts, food logs, weigh-ins and check-ins always reach the client's
 * current coach (owner #SHARE-SIMPLE / #SHARE-JOIN, backend #1061), so there
 * is no switch and nothing is written from here; the old POST /consent/grant
 * and /consent/revoke toggles answer 410. GET /consent/me names the primary
 * coach (400 when there is none). The AI switch is Settings > Roman and AI.
 */
import api from '../services/api';
import { logger } from '../utils/logger';

export interface CoachSharingState {
  coachId: string;
}

export type CoachSharingRead = { kind: 'ok'; state: CoachSharingState } | { kind: 'no_coach' } | { kind: 'error' };

export function parseCoachSharing(body: unknown): CoachSharingState | null {
  const coachId = body && typeof body === 'object' ? (body as { coach_id?: unknown }).coach_id : null;
  return typeof coachId === 'string' ? { coachId } : null;
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
