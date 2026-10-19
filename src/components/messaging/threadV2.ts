/**
 * threadV2 — pure helpers for the messaging v2 thread screens (flag
 * `messaging_core_v2`): bubble side from `sender_id` (the thread routes send
 * no `sender_role`; also right with the flag OFF), the v2 row fields, and the
 * long-press actions per the backend rules (edit and delete: author, inside
 * 48 hours, live message; edit needs text; pins are thread-shared). SHARE-B (featureFlags.shareSendV1): a row's
 * share card, drawn by both bubbles.
 */
import { randomUUID } from 'expo-crypto';
import type { ActionMenuOption } from './ActionMenu';
import type { BubbleMessage } from './MessageBubble';
import { EDIT_WINDOW_MS, type InboxLastMessage, type ReplyPreview } from '../../api/messagingV2Api';
import { readShareCard, type ShareSnapshot } from '../../api/shareCardApi';
import { featureFlags } from '../../config/featureFlags';

export type SenderRole = 'coach' | 'client';

export interface ThreadV2Fields {
  reply_to: ReplyPreview | null;
  deleted: boolean;
  edited_at: string | null;
  pinned_at: string | null;
  client_message_id: string | null;
  drafted?: boolean;
  card?: ShareSnapshot;
}

export function resolveSenderRole(r: Record<string, unknown>, selfId: string | undefined, selfRole: SenderRole): SenderRole {
  const other: SenderRole = selfRole === 'coach' ? 'client' : 'coach';
  if (typeof r.sender_id === 'string' && r.sender_id && selfId) return r.sender_id === selfId ? selfRole : other;
  if (r.sender_role === 'coach' || r.sender_role === 'client') return r.sender_role;
  return other;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function readThreadV2Fields(r: Record<string, unknown>): ThreadV2Fields {
  const rt = r.reply_to && typeof r.reply_to === 'object' ? (r.reply_to as Record<string, unknown>) : null;
  const kinds = ['text', 'voice', 'deleted', 'unavailable'];
  const reply_to: ReplyPreview | null =
    rt && typeof rt.id === 'string' && typeof rt.kind === 'string' && kinds.includes(rt.kind)
      ? {
          id: rt.id,
          sender_id: str(rt.sender_id),
          kind: rt.kind as ReplyPreview['kind'],
          preview: typeof rt.preview === 'string' ? rt.preview : '',
        }
      : null;
  return {
    reply_to,
    deleted: r.deleted === true || !!str(r.deleted_at),
    edited_at: str(r.edited_at),
    pinned_at: str(r.pinned_at),
    client_message_id: str(r.client_message_id),
    drafted: r.ai_draft_id != null && !str(r.voice_url),
    card: featureFlags.shareSendV1 ? readShareCard(r.card) : undefined,
  };
}

/** An inbox row's last line, coach and client inboxes: a card-only message (SHARE-B) has no preview, so it is named. */
export function inboxLine(m: InboxLastMessage): string {
  if (m.kind === 'deleted') return 'Message deleted';
  if (m.kind === 'voice') return 'Voice note';
  return m.preview || (featureFlags.shareSendV1 && m.card_type === 'share' ? 'Shared a card' : 'Message');
}

/** Text shown inside a reply quote for each server quote kind. */
export function replyQuoteText(reply: ReplyPreview): string {
  if (reply.kind === 'deleted') return 'Message deleted';
  if (reply.kind === 'unavailable') return 'Message unavailable';
  if (reply.kind === 'voice') return reply.preview || 'Voice note';
  return reply.preview || 'Message';
}

type LocalParent = { id: string; body: string; sender_role: SenderRole } | null | undefined;

/** Bubble fields for a row: the server quote wins over the local lookup. */
export function bubbleV2Fields(v2: ThreadV2Fields | undefined, clientUserId: string | undefined, local: LocalParent): Pick<BubbleMessage, 'parent' | 'deleted' | 'edited' | 'pinned' | 'drafted' | 'card'> {
  const q = v2?.reply_to;
  const parent = q
    ? { id: q.id, body: replyQuoteText(q), sender_role: (q.sender_id && q.sender_id === clientUserId ? 'client' : 'coach') as SenderRole }
    : local
      ? { id: local.id, body: local.body, sender_role: local.sender_role }
      : null;
  return { parent, deleted: v2?.deleted, edited: !!v2?.edited_at, pinned: !!v2?.pinned_at, drafted: v2?.drafted, card: v2?.card };
}

export function withinEditWindow(createdAt: string, now: number = Date.now()): boolean {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t < EDIT_WINDOW_MS;
}

export function newClientMessageId(): string {
  return randomUUID();
}

export interface MessageActionInput {
  isMine: boolean;
  pending: boolean;
  deleted: boolean;
  hasText: boolean;
  pinned: boolean;
  createdAt: string;
  now?: number;
}

const OPT: Record<string, ActionMenuOption> = {
  retry: { key: 'retry', label: 'Send again', icon: 'refresh' },
  reply: { key: 'reply', label: 'Reply', icon: 'return-up-back-outline' },
  copy: { key: 'copy', label: 'Copy', icon: 'copy-outline' },
  edit: { key: 'edit', label: 'Edit', icon: 'create-outline' },
  pin: { key: 'pin', label: 'Pin', icon: 'pin' },
  unpin: { key: 'unpin', label: 'Unpin', icon: 'pin-outline' },
  delete: { key: 'delete', label: 'Delete for everyone', icon: 'trash-outline', destructive: true },
  report: { key: 'report', label: 'Report Message', icon: 'flag-outline', destructive: true },
};

export function messageActionOptions(m: MessageActionInput): ActionMenuOption[] {
  // An unsent message can only be sent again (same key: never a duplicate) or copied (a card has no text to copy).
  if (m.pending) return m.hasText ? [OPT.retry, OPT.copy] : [OPT.retry];
  if (m.deleted) return m.isMine ? [] : [OPT.report];
  const own = m.isMine && withinEditWindow(m.createdAt, m.now);
  const keys = ['reply', m.hasText && 'copy', own && m.hasText && 'edit', m.pinned ? 'unpin' : 'pin', own && 'delete', !m.isMine && 'report'];
  return keys.filter((k): k is string => !!k).map((k) => OPT[k]);
}
