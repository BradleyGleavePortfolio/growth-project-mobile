/**
 * REFINE-985 (LO-985R1 B1 = LS-985R1 B1): a community DM push marks the DM reads stale (every thread's messages,
 * ['community', 'dm', ...], and the inbox, ['community', 'dms', ...], as useCommunity.ts communityKeys names them) and
 * re-reads the ones on screen, so a message that lands in the thread already open is drawn there: its banner is held
 * back because its own tap would open that screen (foregroundBannerStore.ts showBanner), and useDmMessages has no poll.
 * Called where the push is received and where its tap is delivered, as mealPlanRefresh.ts is. Its own file, importing
 * only the app's queryClient, for the reason mealPlanRefresh.ts gives. It never drops a saved answer, and a re-read that
 * fails takes nothing off the screen: the thread keeps drawing what it had (CommunityDmThreadScreen.tsx, EMPTY-1).
 */
import { queryClient } from './queryClient';
import { refreshDmReadsIn } from './dmReads';

/**
 * REFINE-985R3 (LO-985R2 B1): every way a DM reaches the phone ends in the one list of the DM reads (dmReads.ts): the
 * push received and the app coming back to the front (pushNotifications.ts) and the push's tap (pushTapRouter.ts)
 * through here, with the app's one client; the realtime ping alone through useCommunity.ts onCommunityPing, with the
 * client that hook was given (in the app, the same object).
 */
export function refreshDmReads(): void {
  refreshDmReadsIn(queryClient);
}

/** The server's DM push (backend community-dms.service.ts, kind community_dm_received). */
export function isDmPush(data: Record<string, unknown> | undefined): boolean {
  return data?.kind === 'community_dm_received';
}
