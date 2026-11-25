/**
 * LS-952R2 B1, LS-952R3 B2/B3/C4: the clients whose chat the server says is closed (a block either way), as this coach
 * last heard it, from every place that hears it, each under its own name:
 * - 'inbox': the v2 Messages list (`closed_client_ids` on any page, a `closed` or `blocked_by_me` thread; CoachInboxV2);
 * - 'unread': GET /coach/messages/unread-count's `closed_client_ids`, from every reader of it (rememberUnreadCounts);
 * - `chat:<clientId>`: that client's chat or nudge gate answering closed or open (useChatClosureHeard).
 * A list replaces its own last answer and outdates every older one-client answer; a client's answer replaces its own.
 * usePendingAiDrafts adds them to my own blocks (and to the inbox pages in the cache), so the Messages card, coach Home
 * and the drafts screen leave out these clients' words drafts at once. A new closed client also retires the cached
 * drafts that quote a chat (blockSync retireQuotedChatDrafts), as a block of mine does.
 *
 * Lifetime: each answer is kept under the coach it was asked for and read only for the signed-in coach (useCurrentUser),
 * so sign-out and an account switch drop it with no reset call here, and a late answer for a coach who signed out never
 * replaces the next coach's. It is kept in memory and saved in
 * the app's query cache (CLOSED_CLIENTS_QUERY_KEY), which is persisted with the drafts and cleared with them at sign-out,
 * so a cold start restores both together.
 */
import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { appQueryClient, retireQuotedChatDrafts } from '../lib/blockSync';

export type ClosedClientsSource = 'inbox' | 'unread' | `chat:${string}`;

export interface ClosedAnswer {
  userId: string;
  source: ClosedClientsSource;
  ids: readonly string[];
  /** When it was heard (ms since epoch). */
  at: number;
}

/** Every answer heard, under `${userId} ${source}`: one coach's answers never replace another's. */
export type ClosedClientsBySource = Record<string, ClosedAnswer>;

interface ClosedClientsState {
  bySource: ClosedClientsBySource;
}

export const useClosedClientsStore = create<ClosedClientsState>(() => ({ bySource: {} }));

/** Where the answers are saved in the app's query cache, next to the drafts. */
export const CLOSED_CLIENTS_QUERY_KEY = ['coach', 'closed-clients'] as const;
const COACH_INBOX = ['messaging', 'v2', 'coach-inbox'] as const; // CoachInboxV2 coachInboxKey(filter)

const isChat = (source: string) => source.startsWith('chat:');
const isAnswer = (a: unknown): a is ClosedAnswer => {
  const x = a as Partial<ClosedAnswer> | null;
  return !!x && typeof x.userId === 'string' && typeof x.source === 'string' && Array.isArray(x.ids) && typeof x.at === 'number';
};
const answers = (bySource: unknown): ClosedAnswer[] =>
  (bySource && typeof bySource === 'object' ? Object.values(bySource as Record<string, unknown>).filter(isAnswer) : []);

/** The closed client ids heard for `userId`, from every answer. */
export function closedClientIdsFor(bySource: unknown, userId: string | null | undefined): string[] {
  if (!userId) return [];
  return [...new Set(answers(bySource).filter((a) => a.userId === userId).flatMap((a) => a.ids))];
}

/** `bySource` with `userId`'s answers replaced by `mine`; other coaches' answers are kept as they are. */
function withAnswers(bySource: unknown, userId: string, mine: readonly ClosedAnswer[]): ClosedClientsBySource {
  const out: ClosedClientsBySource = {};
  for (const a of [...answers(bySource).filter((x) => x.userId !== userId), ...mine]) out[`${a.userId} ${a.source}`] = a;
  return out;
}

/** Save one answer for `userId` (the coach it was asked for), heard at `at`; an unchanged or older answer writes nothing. */
export function rememberClosedClients(
  userId: string | null | undefined,
  source: ClosedClientsSource,
  ids: Iterable<string>,
  at: number = Date.now(),
): void {
  if (!userId) return;
  const qc = appQueryClient();
  const saved: unknown = qc?.getQueryData(CLOSED_CLIENTS_QUERY_KEY);
  const heard = useClosedClientsStore.getState().bySource;
  const before = new Map<string, ClosedAnswer>();
  for (const a of [...answers(saved), ...answers(heard)]) if (a.userId === userId) before.set(a.source, a);
  const prev = before.get(source);
  if (prev && prev.at > at) return;
  const next = [...new Set(ids)].sort();
  let changed = !prev || prev.ids.length !== next.length || prev.ids.some((id, i) => id !== next[i]);
  const after = new Map(before).set(source, { userId, source, ids: next, at });
  // A whole list (the inbox, the unread counts) is the newer word on every client's own older answer.
  if (!isChat(source)) {
    for (const [key, a] of after) {
      if (isChat(key) && a.at <= at) {
        after.delete(key);
        changed = true;
      }
    }
  }
  if (!changed) return;
  const mine = [...after.values()];
  useClosedClientsStore.setState({ bySource: withAnswers(heard, userId, mine) });
  if (qc) {
    qc.setQueryDefaults(CLOSED_CLIENTS_QUERY_KEY, { gcTime: Infinity }); // kept (and saved) while no screen reads it
    qc.setQueryData(CLOSED_CLIENTS_QUERY_KEY, withAnswers(saved, userId, mine));
  }
  const was = new Set([...before.values()].flatMap((a) => a.ids));
  if (next.some((id) => !was.has(id))) retireQuotedChatDrafts(qc);
}

/** LS-952R3 B3: hand every GET /coach/messages/unread-count answer here; its `closed_client_ids` is a closure answer. */
export function rememberUnreadCounts(userId: string | null | undefined, res: unknown): void {
  const ids: unknown = (res as { data?: { closed_client_ids?: unknown } } | null | undefined)?.data?.closed_client_ids;
  if (!Array.isArray(ids)) return; // an older server sends none: nothing heard
  rememberClosedClients(userId, 'unread', ids.filter((x): x is string => typeof x === 'string'));
}

/** LS-952R3 B3: one client's chat or nudge gate. Closed is heard at once; open once that screen's reads answered. */
export function useChatClosureHeard(
  userId: string | null | undefined,
  clientId: string | null | undefined,
  answered: boolean,
  closed: boolean,
): void {
  useEffect(() => {
    if (clientId && (answered || closed)) rememberClosedClients(userId, `chat:${clientId}`, closed ? [clientId] : []);
  }, [userId, clientId, answered, closed]);
}

/** LS-952R3 B2: the closed clients on the coach inbox pages in `qc` (restored with the drafts at a cold start). */
export function inboxClosedClientIds(qc: QueryClient): string[] {
  const out = new Set<string>();
  for (const [, data] of qc.getQueriesData<{ pages?: unknown }>({ queryKey: COACH_INBOX })) {
    const pages: unknown = data?.pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages as { closed_client_ids?: unknown; items?: unknown }[]) {
      if (Array.isArray(page?.closed_client_ids)) {
        for (const id of page.closed_client_ids) if (typeof id === 'string') out.add(id);
      }
      if (!Array.isArray(page?.items)) continue;
      for (const t of page.items as { client_id?: unknown; closed?: unknown; blocked_by_me?: unknown }[]) {
        if ((t?.closed === true || t?.blocked_by_me === true) && typeof t.client_id === 'string') out.add(t.client_id);
      }
    }
  }
  return [...out];
}
