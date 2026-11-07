/**
 * LS-952R2 B1: the clients whose chat the server says is closed (a block either way), as the coach's Messages last
 * heard it: `closed_client_ids`, a `closed` or `blocked_by_me` thread, on any page. Each Messages list writes its whole
 * latest answer under its own name, so a lifted block leaves on the next answer. usePendingAiDrafts reads it, so the
 * Messages card, coach Home and the drafts screen leave out these clients' words drafts as they leave out my blocks.
 *
 * Lifetime: each answer is tagged with the coach it was read for and is used only while the block list belongs to that
 * coach (blockedUsersStore userId), so sign-out (retire), reset and an account switch drop it with no reset call here.
 */
import { create } from 'zustand';

export type ClosedClientsSource = 'inbox' | 'legacy';

interface ClosedAnswer {
  userId: string;
  ids: readonly string[];
}

interface ClosedClientsState {
  bySource: Partial<Record<ClosedClientsSource, ClosedAnswer>>;
}

export const useClosedClientsStore = create<ClosedClientsState>(() => ({ bySource: {} }));

/** Save one Messages list's latest answer for `userId` (the signed-in coach); an unchanged answer writes nothing. */
export function rememberClosedClients(
  userId: string | null | undefined,
  source: ClosedClientsSource,
  ids: Iterable<string>,
): void {
  if (!userId) return;
  const next = [...new Set(ids)].sort();
  const prev = useClosedClientsStore.getState().bySource[source];
  if (prev && prev.userId === userId && prev.ids.length === next.length && prev.ids.every((id, i) => id === next[i])) return;
  useClosedClientsStore.setState((s) => ({ bySource: { ...s.bySource, [source]: { userId, ids: next } } }));
}

/** The closed client ids saved for `userId`, from every Messages list. */
export function closedClientIdsFor(
  bySource: ClosedClientsState['bySource'],
  userId: string | null | undefined,
): string[] {
  if (!userId) return [];
  return Object.values(bySource).flatMap((a) => (a && a.userId === userId ? a.ids : []));
}
