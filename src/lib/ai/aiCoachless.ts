/**
 * Who the client-facing AI copy may mention (REFUSAL-COACHLESS-134).
 *
 * Coachless clients can do everything a coached client can except get direct
 * coaching (owner 2026-10-08 15:29), so AI copy never tells them a coach sees
 * their data or is in Messages. Read from the signed-in user's cache, the
 * mirror CoachCodeSheet patches after a join (the same read as the AI consent
 * sheet, growth-project-mobile#592). An empty cache reads as coached, so the
 * coached wording stays the fallback.
 */
import { readUserCacheSync } from '../userCache';

/** True when the signed-in user has an id and no coach attached. */
export function signedInClientIsCoachless(): boolean {
  const user = readUserCacheSync();
  return Boolean(user?.id && !user.coach_id);
}
