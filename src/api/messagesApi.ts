/**
 * messagesApi — Apple 1.2 compliance extension for the DM surface.
 *
 * Legacy CRUD-style messaging endpoints (list / send / mark-read / unread-count)
 * continue to live on `services/api.ts -> messagesApi`. This module exists for
 * the moderation surfaces that ship as part of the iMessage-grade rebuild
 * (backend PR #263, merged):
 *
 *   POST   /messages/report   — report a single message (body carries messageId)
 *   POST   /users/{id}/block  — block a user
 *   DELETE /users/{id}/block  — unblock a user
 *   GET    /users/blocks      — list of users the caller has blocked
 *   POST   /messages          — extended with optional parent_message_id for
 *                               threaded replies
 *
 * No soft-success / 404-is-ok handling: a non-2xx response throws so the caller
 * can render a real failure state and never falsely confirm to the user (R18).
 *
 * Defence in depth: even with backend enforcement, the mobile blocklist is
 * applied client-side via filterOutBlocked so a blocked user's messages never
 * render even if they slip through a stale cache or realtime ping.
 */

import api from '../services/api';
import type { AxiosResponse } from 'axios';

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'sexual'
  | 'hate_speech'
  | 'violence'
  | 'misinformation'
  | 'other';

export const REPORT_REASON_OPTIONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'other', label: 'Something else' },
];

/** Backend cap for the optional free-text context, per PR #263. */
export const DETAILS_MAX = 1000;

export interface ReportMessagePayload {
  reason: ReportReason;
  /** Optional free-text context. Capped to DETAILS_MAX chars on the client. */
  details?: string;
}

export interface ReportMessageResponse {
  ok: boolean;
  report_id?: string;
}

export interface BlockUserResponse {
  ok: boolean;
}

/** Row shape returned by GET /users/blocks (backend PR #263). */
export interface BlockedUserRow {
  blockedId: string;
  displayName: string;
  blockedAt: string;
}

export interface BlockedListResponse {
  blocked: BlockedUserRow[];
}

export interface SendReplyPayload {
  body: string;
  parent_message_id: string;
}

export interface SendReplyResponse {
  id: string;
  body: string;
  sender_role: 'coach' | 'client';
  sender_id?: string;
  created_at: string;
  parent_message_id?: string | null;
}

async function report(
  messageId: string,
  payload: ReportMessagePayload,
): Promise<ReportMessageResponse> {
  if (!messageId) throw new Error('messageId required');
  const body = {
    messageId,
    reason: payload.reason,
    details: payload.details?.slice(0, DETAILS_MAX),
  };
  const res: AxiosResponse<unknown> = await api.post('/messages/report', body);
  const data = (res.data ?? {}) as { id?: string; report_id?: string };
  return { ok: true, report_id: data.report_id ?? data.id };
}

async function block(userId: string): Promise<BlockUserResponse> {
  if (!userId) throw new Error('userId required');
  await api.post(`/users/${encodeURIComponent(userId)}/block`);
  return { ok: true };
}

async function unblock(userId: string): Promise<BlockUserResponse> {
  if (!userId) throw new Error('userId required');
  await api.delete(`/users/${encodeURIComponent(userId)}/block`);
  return { ok: true };
}

async function listBlocked(): Promise<BlockedListResponse> {
  const res: AxiosResponse<unknown> = await api.get('/users/blocks');
  const raw = res.data;
  const arr: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { blocked?: unknown[] } | null)?.blocked)
      ? ((raw as { blocked: unknown[] }).blocked)
      : [];
  const rows: BlockedUserRow[] = arr
    .filter((u): u is Record<string, unknown> => !!u && typeof u === 'object')
    .map((u) => ({
      blockedId: typeof u.blockedId === 'string' ? u.blockedId : '',
      displayName: typeof u.displayName === 'string' ? u.displayName : '',
      blockedAt:
        typeof u.blockedAt === 'string' ? u.blockedAt : new Date().toISOString(),
    }))
    .filter((r) => r.blockedId.length > 0);
  return { blocked: rows };
}

async function sendReply(payload: SendReplyPayload): Promise<SendReplyResponse> {
  const res: AxiosResponse<unknown> = await api.post('/messages', {
    body: payload.body,
    parent_message_id: payload.parent_message_id,
  });
  const raw = (res.data ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id ?? ''),
    body: String(raw.body ?? payload.body),
    sender_role: raw.sender_role === 'coach' ? 'coach' : 'client',
    sender_id: typeof raw.sender_id === 'string' ? raw.sender_id : undefined,
    created_at:
      typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    parent_message_id:
      typeof raw.parent_message_id === 'string'
        ? raw.parent_message_id
        : payload.parent_message_id,
  };
}

export const messagesModerationApi = {
  report,
  block,
  unblock,
  listBlocked,
  sendReply,
};
