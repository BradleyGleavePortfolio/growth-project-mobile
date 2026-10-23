/**
 * FX-872: one block cache for the whole phone. Both block routes (coaching POST/DELETE /users/:id/block from a profile
 * or Settings, community POST/DELETE /community/blocks from a post, a DM or Community safety) write the same server
 * table, so both API wrappers report here after the server says yes. Every screen then reads the same answer at once.
 *
 * Owner 10-23 "Dissapear": a blocked one-to-one chat leaves the lists. On block the conversation drops out of the cached
 * DM list and the coach inbox at once (the server drops it on the next read); on unblock both lists, the DM reads and
 * the coaching row read again, so the chat comes back.
 */
import type { InfiniteData } from '@tanstack/react-query';
import { queryClient } from '../services/queryClient';
import { useBlockedUsersStore, type BlockedUser } from '../store/blockedUsersStore';
import { closedRefusals } from '../components/messaging/closedRefusal';

const DM_LISTS = ['community', 'dms'] as const; // communityKeys.dmThreads(workspaceId)
const DM_READS = ['community', 'dm'] as const; // communityKeys.dmMessages(workspaceId, recipientId)
const COACH_INBOX = ['messaging', 'v2', 'coach-inbox'] as const; // CoachInboxV2 coachInboxKey(filter)
const COACHING_ROW = ['messaging', 'v2', 'coaching-row'] as const; // ConversationClosed coachingRowKey
const BLOCK_LISTS = [['community', 'safety', 'blocks']] as const; // communitySafetyKeys.blocks (Community safety)

type Row = { other_user_id?: unknown; client_id?: unknown; coach_id?: unknown };
type Page = { items?: Row[] };
const isOther = (userId: string) => (r: Row) => r.other_user_id !== userId && r.client_id !== userId;

export type BlockedWho = Partial<Pick<BlockedUser, 'displayName' | 'role'>>;

/** The server placed my block on `userId`. */
export function blockPlaced(userId: string, who: BlockedWho = {}): void {
  if (!userId) return;
  const store = useBlockedUsersStore.getState();
  const known = store.blocked.find((b) => b.id === userId);
  void store.block({
    id: userId,
    displayName: who.displayName || known?.displayName || 'Blocked user',
    role: who.role ?? known?.role ?? 'other',
  });
  queryClient.setQueriesData<Row[]>({ queryKey: DM_LISTS }, (old) => (Array.isArray(old) ? old.filter(isOther(userId)) : old));
  queryClient.setQueriesData<InfiniteData<Page>>({ queryKey: COACH_INBOX }, (old) =>
    old?.pages ? { ...old, pages: old.pages.map((p) => ({ ...p, items: (p.items ?? []).filter(isOther(userId)) })) } : old,
  );
  BLOCK_LISTS.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
}

/** The server lifted my block on `userId`: the chat opens again everywhere and comes back to the lists. */
export function blockLifted(userId: string): void {
  if (!userId) return;
  void useBlockedUsersStore.getState().unblock(userId);
  closedRefusals.clear(userId);
  [DM_LISTS, DM_READS, COACH_INBOX, COACHING_ROW, ...BLOCK_LISTS].forEach(
    (queryKey) => void queryClient.invalidateQueries({ queryKey }),
  );
}
