/**
 * FX-872: one block cache for the whole phone. Both block routes (coaching POST/DELETE /users/:id/block from a profile
 * or Settings, community POST/DELETE /community/blocks from a post, a DM or Community safety) write the same server
 * table, so both API wrappers report here after the server says yes. Every screen then reads the same answer at once.
 *
 * Owner 10-23 "Dissapear": a blocked one-to-one chat leaves the lists. On block the conversation drops out of the cached
 * DM list and the coach inbox at once (the server drops it on the next read); on unblock both lists, the DM reads and
 * the coaching row read again, so the chat comes back.
 */
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { useBlockedUsersStore, ownsBlockList, type BlockedUser } from '../store/blockedUsersStore';
import { closedRefusals } from '../components/messaging/closedRefusal';

// The app's one query client registers itself here (services/queryClient.ts), so the API wrappers that call here never
// load the cache module themselves. Before it registers there is no cached list to update.
let client: QueryClient | null = null;
export function registerBlockSyncClient(qc: QueryClient): void {
  client = qc;
}
/** The app's one query client, once it registered (closedClientsStore saves its answers there). */
export function appQueryClient(): QueryClient | null {
  return client;
}

const DM_LISTS = ['community', 'dms'] as const; // communityKeys.dmThreads(workspaceId)
const DM_READS = ['community', 'dm'] as const; // communityKeys.dmMessages(workspaceId, recipientId)
const COACH_INBOX = ['messaging', 'v2', 'coach-inbox'] as const; // CoachInboxV2 coachInboxKey(filter)
const COACHING_ROW = ['messaging', 'v2', 'coaching-row'] as const; // ConversationClosed coachingRowKey
const BLOCK_LISTS = [['community', 'safety', 'blocks']] as const; // communitySafetyKeys.blocks (Community safety)
const COACH_CHAT = ['messaging', 'coach-chat-closed'] as const; // useCoachChatClosed COACH_CHAT_KEY (FR-880R2)
// Tab badges and the coach row's count (SpaceTree, Community Home and the drawer) re-read their counts.
const BADGES = [['messages', 'unread-count'], ['community', 'me'], ['community', 'home', 'coach-unread']] as const;
const AI_DRAFTS = ['coach', 'ai', 'pending-drafts'] as const; // usePendingAiDrafts COACH_AI_PENDING_DRAFTS_QUERY_KEY

// A draft written from a coach chat message (backend ai-approval.service.ts refsOf: provenance `coach_messages` refs).
function quotesChat(d: unknown): boolean {
  const p: unknown = (d as { provenance?: unknown } | null)?.provenance;
  return Array.isArray(p) && p.some((e) => e?.source === 'coach_messages' && typeof e?.ref === 'string');
}

/**
 * LS-952R3 B4: after a new block either way, the server leaves out every draft quoting a chat message whose author is
 * in a block with this coach (ai-approval.service.ts withoutBlockedSources), a workout or meal plan too. The phone holds
 * only the message ids, not their authors, so every cached draft that quotes a chat leaves at once and the queue is read
 * again; the server's answer brings back the ones still allowed. A draft quoting no chat is left as it is.
 */
export function retireQuotedChatDrafts(queryClient: QueryClient | null = client): void {
  if (!queryClient) return;
  const state = queryClient.getQueryState<{ drafts?: unknown[] }>(AI_DRAFTS);
  const drafts = state?.data?.drafts;
  if (!Array.isArray(drafts) || !drafts.some(quotesChat)) return;
  queryClient.setQueryData(AI_DRAFTS, { ...state!.data, drafts: drafts.filter((d) => !quotesChat(d)) }, { updatedAt: state!.dataUpdatedAt });
  void queryClient.invalidateQueries({ queryKey: AI_DRAFTS, exact: true });
}

type Row = { other_user_id?: unknown; client_id?: unknown; coach_id?: unknown; unread_count?: unknown };
type Page = { items?: Row[]; total_unread?: unknown };
const isOther = (userId: string) => (r: Row) => r.other_user_id !== userId && r.client_id !== userId;

export type BlockedWho = Partial<Pick<BlockedUser, 'displayName' | 'role'>>;

/** The server placed my block on `userId`. `heldOwner` (blockListOwner() before the request, LS-914 B1): an answer
 *  that lands after sign-out or an account switch writes nothing, neither the list nor the cached lists. */
export function blockPlaced(userId: string, who: BlockedWho = {}, heldOwner?: number): void {
  if (!userId || !ownsBlockList(heldOwner)) return;
  const store = useBlockedUsersStore.getState();
  const known = store.blocked.find((b) => b.id === userId);
  void store.block(
    {
      id: userId,
      displayName: who.displayName || known?.displayName || 'Blocked user',
      role: who.role ?? known?.role ?? 'other',
    },
    heldOwner,
  );
  const queryClient = client;
  if (!queryClient) return;
  queryClient.setQueriesData<Row[]>({ queryKey: DM_LISTS }, (old) => (Array.isArray(old) ? old.filter(isOther(userId)) : old));
  queryClient.setQueriesData<InfiniteData<Page>>({ queryKey: COACH_INBOX }, (old) => {
    if (!old?.pages) return old;
    // Its unread leaves the inbox count too (counted 0 everywhere); total_unread is the whole inbox's, on every page.
    const gone = old.pages
      .flatMap((p) => (p.items ?? []).filter((r) => !isOther(userId)(r)))
      .reduce((n, r) => n + (typeof r.unread_count === 'number' ? r.unread_count : 0), 0);
    const pages = old.pages.map((p) => ({
      ...p,
      items: (p.items ?? []).filter(isOther(userId)),
      ...(typeof p.total_unread === 'number' ? { total_unread: Math.max(0, p.total_unread - gone) } : {}),
    }));
    return { ...old, pages };
  });
  [COACH_CHAT, ...BLOCK_LISTS, ...BADGES].forEach((queryKey) => void queryClient.invalidateQueries({ queryKey }));
  retireQuotedChatDrafts(queryClient);
}

/** The server lifted my block on `userId`: the chat opens again everywhere and comes back to the lists. */
export function blockLifted(userId: string, heldOwner?: number): void {
  if (!userId || !ownsBlockList(heldOwner)) return;
  void useBlockedUsersStore.getState().unblock(userId, heldOwner);
  closedRefusals.clear(userId);
  const queryClient = client;
  if (!queryClient) return;
  // LS-952R3 B4: the drafts that quoted their chat come back on the next queue read.
  [DM_LISTS, DM_READS, COACH_INBOX, COACHING_ROW, COACH_CHAT, AI_DRAFTS, ...BLOCK_LISTS, ...BADGES].forEach(
    (queryKey) => void queryClient.invalidateQueries({ queryKey }),
  );
}
