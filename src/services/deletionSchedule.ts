/**
 * JOINOFFER-DEL (LO-898R4 C-1): does this session know its account's deletion is scheduled?
 *
 * A coach who schedules the deletion and signs out ("Sign out" on the scheduled view) may never
 * sign in on this phone again; the server completes the deletion after the grace period and the
 * phone never hears of it. So signOut treats "deletion scheduled in this session" like a
 * confirmed deletion for the per-account marks an ordinary sign-out keeps on purpose
 * (authActions deletedAccountKeys). deletionApi notes every status it reads: "confirmed" (from
 * the status check or the request) is scheduled; anything else, or a cancel, is not.
 *
 * Memory only, never stored, and bound to the session generation: a later sign-in (a new
 * generation) forgets it.
 */
import { sessionGeneration } from './sessionFence';

let scheduledIn: number | null = null;

/** Called by deletionApi with the deletion state the server just returned. */
export function noteDeletionState(state: string | null | undefined): void {
  scheduledIn = state === 'confirmed' ? sessionGeneration() : null;
}

/** True while this session's account has a scheduled (not cancelled) deletion. */
export function deletionScheduledThisSession(): boolean {
  return scheduledIn !== null && scheduledIn === sessionGeneration();
}
