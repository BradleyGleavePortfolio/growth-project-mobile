/**
 * FIX-913M (LS-913M B1): the account refresh RomanJoinOfferHost used to run, kept without its retired
 * after-join sheet (STORE-E4). A web join (coach landing page, storefront or guest checkout) happens on
 * the server while the client may stay signed in here. On opening the client app and on each return from
 * the background, a client cached without a coach re-reads their account (GET /auth/me, the paid in-app
 * join's read); a coach the server confirms goes into the user cache, so Roman and Community open
 * (useClientNeedsCoach). A client with a coach and a coach account send nothing extra. Nothing here asks
 * for or grants AI permission.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { patchUserCache, readUserCacheSync } from '../lib/userCache';
import { authApi } from '../services/api';
import { logger } from '../utils/logger';

export async function learnServerCoach(): Promise<void> {
  const user = readUserCacheSync();
  if (!user?.id || user.coach_id || user.role !== 'student') return;
  const me = ((await authApi.me())?.data ?? {}) as { id?: unknown; coach_id?: unknown };
  const coachId = me.id === user.id && typeof me.coach_id === 'string' ? me.coach_id : '';
  const now = readUserCacheSync();
  // Only for the same signed-in account, still without a coach here; never written after a sign-out.
  if (coachId && now?.id === user.id && !now.coach_id) await patchUserCache({ coach_id: coachId });
}

/** Mounted once in ClientNavigator: opening the client app (cold start or sign-in) and each return from the background. */
export function useServerCoachRefresh(): void {
  useEffect(() => {
    const learn = () => {
      learnServerCoach().catch((err: unknown) => logger.warn('ServerCoachRefresh', 'account read failed', err));
    };
    learn();
    let away = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') away = true;
      if (state !== 'active' || !away) return;
      away = false;
      learn();
    });
    return () => sub.remove();
  }, []);
}
