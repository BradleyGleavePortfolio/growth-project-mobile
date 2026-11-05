/**
 * The coach's own block list, for every coach surface that offers Message, Ask Roman, Reply, Nudge or Say hello to a
 * client (the Home's Plan ended list, the Clients lookup). It reads the list on mount the way the chat screens do
 * (`useBlockedUsersHydration`: this phone's copy first, then GET /users/blocks, whose list replaces it; FX-872), so a
 * cold start never offers messaging to a client the coach blocked earlier (LO m#866 B1, m#859 C1).
 *
 * `known` is false until this phone's copy for this coach has been read; a surface holds its rows until then. A block
 * or an unblock made on another phone shows here when GET /users/blocks answers.
 */
import { useMemo } from 'react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useBlockedUsersHydration } from '../../../hooks/useBlockedUsersHydration';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { lookupReason, type LookupReason, type UnreadByClient } from '../../../utils/coach/clientLookup';
import type { RosterClient } from '../../../utils/coach/clientRoster';

export interface CoachBlockList {
  /** This phone's copy of the coach's block list has been read. */
  known: boolean;
  /** The client ids the coach blocked. */
  blockedIds: ReadonlyArray<string>;
}

export function useCoachBlockList(): CoachBlockList {
  const coachId = useCurrentUser()?.id ?? null;
  useBlockedUsersHydration(coachId);
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const read = useBlockedUsersStore((s) => s.hydrated && s.userId === coachId);
  const blockedIds = useMemo(() => blocked.map((b) => b.id), [blocked]);
  return { known: !!coachId && read, blockedIds };
}

/**
 * Needs you's one rule, for the Clients lookup's Needs you and the Home's "Needs you, N" tile, so the tile's N is the
 * list's length (LO m#866 B2). Owner (b#1141): a blocked pair gets no messaging at all, so a blocked client's Reply,
 * Nudge or Say hello is no action; Review stays.
 */
export function needsYouReason(c: RosterClient, unread: UnreadByClient, blockedIds: ReadonlySet<string>, now?: Date): LookupReason {
  const r = lookupReason(c, unread, 'needs', now);
  return r.action && r.action !== 'review' && blockedIds.has(c.id) ? { ...r, action: null } : r;
}
