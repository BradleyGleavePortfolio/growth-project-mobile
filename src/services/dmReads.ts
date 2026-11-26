/**
 * REFINE-985R3 (LO-985R2 B1): the DM reads, the one list of them. Every thread's messages (['community', 'dm', ...])
 * and the inbox (['community', 'dms', ...]), as useCommunity.ts communityKeys names them, are marked stale in the query
 * client it is handed, and the ones on screen are read again. It never drops a saved answer.
 * Its own file with no import but a type: the hook that answers a realtime ping (useCommunity.ts onCommunityPing) calls
 * it with the client it was given, and must not load the app's own client to do so (a test's react-query stand-in
 * cannot build that client: the reason mealPlanRefresh.ts gives). dmRefresh.ts calls it with the app's client.
 */
import type { QueryClient } from '@tanstack/react-query';

export function refreshDmReadsIn(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['community', 'dm'] });
  void client.invalidateQueries({ queryKey: ['community', 'dms'] });
}
