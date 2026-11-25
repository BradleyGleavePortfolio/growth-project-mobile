/**
 * LS-952R3 B5: counts the completed roster reads that changed who is on the list. usePendingAiDrafts reads the drafts
 * queue again when the roster changed after its last read, so a client who moved to another coach leaves the shared
 * count on the server's answer (backend ai-approval.service.ts keepOnRoster). The phone does not drop a client itself:
 * a client missing from one list (an archived or a filtered one) is not a move.
 */
import { create } from 'zustand';

export const useRosterVersion = create<{ version: number }>(() => ({ version: 0 }));

const lastIds = new Map<string, string>();

/** coachStore.loadClients: a whole roster read for `status` completed with these clients. */
export function rosterLoaded(status: string, ids: readonly string[]): void {
  const key = [...ids].sort().join('\n');
  if (lastIds.get(status) === key) return;
  lastIds.set(status, key);
  useRosterVersion.setState((s) => ({ version: s.version + 1 }));
}
