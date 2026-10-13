/**
 * UI-2 second PR: the roster rows (for the Steady wall and the tiles' "Logged ..." line), the streak list and
 * the unread messages per client. Each read settles on its own; a failed read keeps what was on screen (the
 * roster starts as null, so a roster that never loads leaves the wall and the Steady chip out). Only the newest
 * load writes, and nothing writes after unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WinStreakEntry } from '../../../services/commandCenterApi';
import type { RosterClient } from '../../../utils/coach/clientRoster';
import { rosterSources, type RosterSources } from './rosterSources';

export interface RosterWallData {
  clients: RosterClient[] | null;
  streaks: WinStreakEntry[];
  unread: Record<string, number>;
  /** True once the roster and the streak list have each answered (or failed) at least once. */
  settled: boolean;
}

export function useRosterWall(sources: RosterSources = rosterSources) {
  const [clients, setClients] = useState<RosterClient[] | null>(null);
  const [streaks, setStreaks] = useState<WinStreakEntry[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [clientsTried, setClientsTried] = useState(false);
  const [streaksTried, setStreaksTried] = useState(false);
  const seq = useRef(0);
  useEffect(() => () => { seq.current += 1; }, []);

  const load = useCallback(() => {
    const mine = ++seq.current;
    const settle = <T,>(read: () => Promise<T>, write: (v: T) => void, tried?: (t: boolean) => void) =>
      void Promise.resolve().then(read)
        .then((v) => { if (mine === seq.current) write(v); }, () => undefined)
        .then(() => { if (mine === seq.current) tried?.(true); });
    settle(sources.clients, setClients, setClientsTried);
    settle(sources.winStreaks, setStreaks, setStreaksTried);
    settle(sources.unreadByClient, setUnread);
  }, [sources]);

  const first = useRef(load);
  first.current = load;
  useEffect(() => { first.current(); }, []);

  const roster: RosterWallData = { clients, streaks, unread, settled: clientsTried && streaksTried };
  return { roster, reloadRoster: load };
}
