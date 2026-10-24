/**
 * FR-880R2 (owner 10-23 "Dissapear"; Sol B2): is the client's coaching chat closed? One answer for every client place
 * that lists the coach or opens the chat: the Messages list with messaging_core_v2 off, Community Home and the drawer
 * (SpaceTree), and Home's "Message {coach}".
 *
 * Closed when I blocked my coach (the block cache, at once), a send this session was refused as closed, or the thread
 * read answers with `x-conversation-closed` (b#1141 CONTRACT 6370968268: either person blocks, any messaging version).
 * No answer yet counts as open, and a failed read keeps the last answer. Block and unblock read it again (blockSync).
 */
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { queryClient } from '../services/queryClient';
import { useBlockedUsersStore } from '../store/blockedUsersStore';
import { closedByHeader, closedRefusals } from '../components/messaging/closedRefusal';

export const COACH_CHAT_KEY = ['messaging', 'coach-chat-closed'] as const;

/** The client's own coaching thread read (GET /messages, one message): true when the server says it is closed. */
export async function readCoachChatClosed(): Promise<boolean> {
  return closedByHeader(await api.get('/messages?limit=1'));
}

export function useCoachChatClosed(coachId: string | null | undefined): { closed: boolean; known: boolean } {
  const mine = useBlockedUsersStore((s) => !!coachId && s.blocked.some((b) => b.id === coachId));
  const refused = useSyncExternalStore(closedRefusals.subscribe, () => closedRefusals.has(coachId));
  const q = useQuery({
    queryKey: [...COACH_CHAT_KEY, coachId ?? ''],
    enabled: !!coachId,
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false, // a failed read settles at once and keeps the last answer; the next 30 s read tries again
    meta: { persist: false }, // never an answer saved to the phone on an earlier visit
    queryFn: readCoachChatClosed,
  }, queryClient); // the app's one client (also outside a provider), so blockSync reads it again on block and unblock
  if (!coachId) return { closed: false, known: true };
  return { closed: mine || refused || q.data === true, known: mine || refused || q.data !== undefined || q.isError };
}
