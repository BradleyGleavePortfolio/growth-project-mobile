/**
 * The coach's own block list, for every coach surface that offers Message, Ask Roman, Reply, Nudge or Say hello to a
 * client (the Home's Plan ended list, the Clients lookup). It reads the list on mount the way the chat screens do
 * (`useBlockedUsersHydration`: this phone's copy first, then GET /users/blocks, which only adds), so a cold start never
 * offers messaging to a client the coach blocked earlier (LO m#866 B1, m#859 C1).
 *
 * `known` is false until this phone's copy for this coach has been read; a surface holds its rows until then. A block
 * made on another phone and missing from this one shows here when GET /users/blocks answers.
 */
import { useMemo } from 'react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useBlockedUsersHydration } from '../../../hooks/useBlockedUsersHydration';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';

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
