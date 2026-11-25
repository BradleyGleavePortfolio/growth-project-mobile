/**
 * REFINE-985 (LO-985R1 B1 = LS-985R1 B1): a community DM push marks the DM reads stale (every thread's messages,
 * ['community', 'dm', ...], and the inbox, ['community', 'dms', ...], as useCommunity.ts communityKeys names them) and
 * re-reads the ones on screen, so a message that lands in the thread already open is drawn there: its banner is held
 * back because its own tap would open that screen (foregroundBannerStore.ts showBanner), and useDmMessages has no poll.
 * Called where the push is received and where its tap is delivered, as mealPlanRefresh.ts is. Its own file, importing
 * only the app's queryClient, for the reason mealPlanRefresh.ts gives. It never drops a saved answer.
 */
import type { QueryClient } from '@tanstack/react-query';
import { queryClient } from './queryClient';

/**
 * REFINE-985R3 (LO-985R2 B1): the one list of the DM reads, for every way a DM reaches the phone: the push received
 * (pushNotifications.ts), its tap (pushTapRouter.ts), the realtime ping alone (useCommunity.ts onCommunityPing, which
 * answers for the query client it was handed and so passes it) and the app coming back to the front
 * (pushNotifications.ts). With no argument it is the app's one client, which is also the one the hooks are given.
 */
export function refreshDmReads(client: QueryClient = queryClient): void {
  void client.invalidateQueries({ queryKey: ['community', 'dm'] });
  void client.invalidateQueries({ queryKey: ['community', 'dms'] });
}

/** The server's DM push (backend community-dms.service.ts, kind community_dm_received). */
export function isDmPush(data: Record<string, unknown> | undefined): boolean {
  return data?.kind === 'community_dm_received';
}
