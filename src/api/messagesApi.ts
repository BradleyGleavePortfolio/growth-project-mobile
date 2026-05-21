/**
 * messagesApi — Apple 1.2 compliance extension for the DM surface.
 *
 * Legacy CRUD-style messaging endpoints (list / send / mark-read / unread-count)
 * continue to live on `services/api.ts -> messagesApi`. This module exists for
 * the *new* moderation surfaces that ship as part of the iMessage-grade rebuild:
 *
 *   POST /messages/{id}/report   — report a single message
 *   POST /users/{id}/block       — block a user
 *   POST /users/{id}/unblock     — unblock a user
 *   GET  /users/blocks           — list of user IDs the caller has blocked
 *   POST /messages               — extended with optional parent_message_id
 *                                  for threaded replies
 *
 * Endpoint contract status (May 21 2026):
 *   - /messages/{id}/report   — TODO: backend endpoint not yet shipped. The
 *     call sends the report payload; backend will return 404 until the
 *     endpoint is added. Tracking issue on growth-project-backend titled
 *     "feat(messages): add report + block endpoints for Apple 1.2 compliance".
 *   - /users/{id}/block       — TODO: same backend issue.
 *   - parent_message_id       — sent as an additional field on the existing
 *     POST /messages body. The backend silently ignores unknown fields today
 *     for this DTO, so mobile reply state survives client-side and the field
 *     becomes live the moment the backend lands.
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
  | 'sexual_content'
  | 'self_harm'
  | 'other';

export const REPORT_REASON_OPTIONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'self_harm', label: 'Self-harm or suicide' },
  { value: 'other', label: 'Something else' },
];

export interface ReportMessagePayload {
  reason: ReportReason;
  /** Optional free-text context. Capped to 500 chars on the client. */
  details?: string;
}

export interface ReportMessageResponse {
  ok: boolean;
  report_id?: string;
}

export interface BlockUserResponse {
  ok: boolean;
}

export interface BlockedListResponse {
  blocked_user_ids: string[];
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
  if (!messageId) return { ok: false };
  const trimmed: ReportMessagePayload = {
    reason: payload.reason,
    details: payload.details?.slice(0, 500),
  };
  try {
    const res: AxiosResponse<unknown> = await api.post(
      `/messages/${encodeURIComponent(messageId)}/report`,
      trimmed,
    );
    const data = (res.data ?? {}) as { id?: string; report_id?: string };
    return { ok: true, report_id: data.report_id ?? data.id };
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    if (status === 404 || status === 501) {
      // Endpoint not yet deployed — soft success, the local report log + the
      // analytics event still capture the user-visible intent.
      return { ok: true };
    }
    throw err;
  }
}

async function block(userId: string): Promise<BlockUserResponse> {
  if (!userId) return { ok: false };
  try {
    await api.post(`/users/${encodeURIComponent(userId)}/block`);
    return { ok: true };
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    if (status === 404 || status === 501) return { ok: true };
    throw err;
  }
}

async function unblock(userId: string): Promise<BlockUserResponse> {
  if (!userId) return { ok: false };
  try {
    await api.post(`/users/${encodeURIComponent(userId)}/unblock`);
    return { ok: true };
  } catch (err) {
    const status = (err as { response?: { status?: number } } | null)?.response?.status;
    if (status === 404 || status === 501) return { ok: true };
    throw err;
  }
}

async function listBlocked(): Promise<BlockedListResponse> {
  try {
    const res: AxiosResponse<unknown> = await api.get('/users/blocks');
    const data = (res.data ?? {}) as { blocked_user_ids?: unknown };
    const ids = Array.isArray(data.blocked_user_ids)
      ? data.blocked_user_ids.filter((v): v is string => typeof v === 'string')
      : [];
    return { blocked_user_ids: ids };
  } catch {
    return { blocked_user_ids: [] };
  }
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
