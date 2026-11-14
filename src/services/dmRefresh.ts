/**
 * REFINE-985 (LO-985R1 B1 = LS-985R1 B1): a community DM push marks the DM reads stale (every thread's messages,
 * ['community', 'dm', ...], and the inbox, ['community', 'dms', ...], as useCommunity.ts communityKeys names them) and
 * re-reads the ones on screen, so a message that lands in the thread already open is drawn there: its banner is held
 * back because its own tap would open that screen (foregroundBannerStore.ts showBanner), and useDmMessages has no poll.
 * Called where the push is received and where its tap is delivered, as mealPlanRefresh.ts is. Its own file, importing
 * only the app's queryClient, for the reason mealPlanRefresh.ts gives. It never drops a saved answer.
 */
import { queryClient } from './queryClient';

export function refreshDmReads(): void {
  void queryClient.invalidateQueries({ queryKey: ['community', 'dm'] });
  void queryClient.invalidateQueries({ queryKey: ['community', 'dms'] });
}

/** The server's DM push (backend community-dms.service.ts, kind community_dm_received). */
export function isDmPush(data: Record<string, unknown> | undefined): boolean {
  return true;
}
