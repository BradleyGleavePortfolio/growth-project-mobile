import { useCurrentUser } from './useCurrentUser';
import { readUserCacheSync } from '../lib/userCache';

/** Display-only: prefer the mirror patched by CoachCodeSheet after a join. */
export function useCoachlessClient(): boolean {
  const currentUser = useCurrentUser();
  const user = readUserCacheSync() ?? currentUser;
  return Boolean(user?.id && !user.coach_id);
}
