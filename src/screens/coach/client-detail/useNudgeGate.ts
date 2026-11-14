/**
 * NUDGE-GATE-M (FIX-933R2 "Found, not fixed", comment 6665087764): Send nudge is messaging, so the client file's and the
 * risk screen's nudge take the same gate as m#933's peek and the chat (BLOCK-ALL-M, FX-872, owner b#1141). The pair is
 * 'me' (this coach blocked them: the one block list, home-v11/blockList.ts), 'them' (the server's closed_client_ids on
 * GET /coach/messages/unread-count, b#1153: a block either way, read as MessagesScreen does, absent on an older server),
 * 'open', or null until both have answered. Send nudge is offered only when `open`; `closed` draws the chat's line
 * (ConversationClosedLine with `by`: BAM-2a, BAM-2b) in its place. A failed read stays null: no nudge, no line.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClosedBy, useConversationClosed, type ClosedBy } from '../../../components/messaging/ConversationClosed';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { coachApi } from '../../../services/api';
import { rememberUnreadCounts, useChatClosureHeard } from '../../../store/closedClientsStore';
import { useCoachBlockList } from '../home-v11/blockList';

export type NudgePair = 'open' | 'me' | 'them' | null;

export interface NudgeGate {
  pair: NudgePair;
  /** The server has answered and the pair is open: Send nudge may draw. */
  open: boolean;
  /** A block either way (or a refusal remembered this session): draw the closed line instead. */
  closed: boolean;
  by: ClosedBy;
  /** Read closed_client_ids again (pull to refresh). */
  reload: () => Promise<void>;
  /** FIX-940 (LO-T2B B1): hand it a failed send; true (and closed, remembered for the session) when it means closed. */
  close: (err: unknown) => boolean;
}

export function useNudgeGate(clientId: string): NudgeGate {
  const coachId = useCurrentUser()?.id ?? null;
  const blockList = useCoachBlockList();
  // Each answer carries the coach and client it was read for, so it is used only for them; null until one answers.
  const [read, setRead] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const key = `${coachId ?? ''}:${clientId}`;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!coachId) return;
    const mine = ++seq.current;
    try {
      const res = await coachApi.getUnreadCounts();
      rememberUnreadCounts(coachId, res); // LS-952R3 B3: Roman's drafts count hears it too
      const closed: unknown = res?.data?.closed_client_ids;
      const ids = new Set(Array.isArray(closed) ? closed.filter((x): x is string => typeof x === 'string') : []);
      if (mine === seq.current) setRead({ key, ids });
    } catch {
      // A failed read keeps the last answer (none yet: the nudge stays hidden).
    }
  }, [coachId, key]);
  useEffect(() => {
    void reload();
    return () => { seq.current += 1; };
  }, [reload]);

  const known = blockList.known && read?.key === key;
  const pair: NudgePair = !known ? null
    : blockList.blockedIds.includes(clientId) ? 'me' : read?.ids.has(clientId) ? 'them' : 'open';
  // FIX-940 (LO-T2B C1): an unknown pair says nothing (undefined), so it never clears a refusal remembered this session.
  const gate = useConversationClosed(clientId, [], pair != null, pair == null ? undefined : pair !== 'open');
  const by = useClosedBy(clientId, gate.closed, { pair: true, mine: pair === 'me' });
  useChatClosureHeard(coachId, clientId, pair != null, gate.closed); // LS-952R3 B3: a refusal closes it there too
  return { pair, open: gate.open, closed: gate.closed, by, reload, close: gate.close };
}
