/**
 * UI-2 second PR: the extra reads behind the chips, the Steady wall and the unread badges, all on existing
 * endpoints. Swappable in tests.
 */
import { useCoachStore } from '../../../store/coachStore';
import { coachApi } from '../../../services/api';
import { commandCenterApi, type WinStreakEntry } from '../../../services/commandCenterApi';
import { readUserCache } from '../../../lib/userCache';
import type { RosterClient } from '../../../utils/coach/clientRoster';

export const rosterSources = {
  /** The active roster with each row's activity block (the shared roster store, as Messages reads it). */
  clients: async (): Promise<RosterClient[]> => {
    const me = await readUserCache();
    if (!me?.id) throw new Error('no signed-in coach');
    await useCoachStore.getState().loadClients(me.id, 'active', { silent: true });
    const { clients, loadError } = useCoachStore.getState();
    if (loadError) throw new Error(loadError);
    return clients;
  },
  winStreaks: async (): Promise<WinStreakEntry[]> => {
    const res = await commandCenterApi.getWinStreaks();
    return Array.isArray(res?.data?.items) ? res.data.items : [];
  },
  /** Unread messages per client id, as the Messages tab reads them. */
  unreadByClient: async (): Promise<Record<string, number>> => {
    const res = await coachApi.getUnreadCounts();
    const raw = (res?.data ?? {}) as { by_client?: unknown; byClient?: unknown };
    const map = (raw.by_client ?? raw.byClient ?? {}) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(map)) {
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[id] = Math.floor(n);
    }
    return out;
  },
};

export type RosterSources = typeof rosterSources;
