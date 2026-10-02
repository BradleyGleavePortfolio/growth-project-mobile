/**
 * romanChatsApi: the signed-in user's own Roman chat history (backend #635,
 * docs/roman-chat-deletion.md, src/roman/roman-chats.controller.ts).
 *
 *   GET    /roman/sessions?limit=&cursor=   the caller's live chats, newest first
 *                                           { sessions: [...], nextCursor }
 *   DELETE /roman/sessions/:id              erase one chat (any day) -> 204
 *   DELETE /roman/sessions                  erase every chat -> 204
 *   GET    /roman/sessions/:id/messages     read one chat (behind the Roman
 *                                           chat switch, so it can 404 uncoded)
 *
 * Owner decision 2026-10-01 20:32 and ruling OR-110-1: Roman chats are kept
 * until the client deletes them or their account. These calls are the
 * client's way to find and erase any of them. List and delete are NOT behind
 * the Roman chat switch on the server, so they work even when chat is off.
 *
 * Every call resolves to an outcome and never throws. Failures are read from
 * the HTTP status AND the machine `code` (never from message text), so each
 * known case gets its own copy on the screen and only an unknown case falls
 * back to a support reference.
 *
 * Ids are opaque strings (the backend uses cuid, not uuid), validated only
 * for shape and length. Message text is never logged or reported anywhere.
 */
import { z } from 'zod';
import api from '../services/api';
import { supportReferenceOf } from '../utils/correlation';
import type { RomanMessage, RomanSurface } from './romanApi';

/** Backend default and maximum page size (roman.constants.ts). */
export const ROMAN_CHATS_PAGE_LIMIT = 30;
export const ROMAN_CHATS_MAX_LIMIT = 100;
/** ListSessionsQueryDto / ListMessagesQueryDto cursor @MaxLength(64). */
const ID_MAX = 64;

/** Backend machine codes (roman.constants.ts on #635). */
export const ROMAN_SESSION_NOT_FOUND = 'ROMAN_SESSION_NOT_FOUND';
export const ROMAN_ERASE_INCOMPLETE = 'ROMAN_ERASE_INCOMPLETE';
export const ROMAN_CURSOR_INVALID = 'ROMAN_CURSOR_INVALID';

const IdSchema = z.string().min(1).max(ID_MAX);
const IsoSchema = z.string().datetime({ offset: true });

/** One chat in the list (RomanSessionListItemView): metadata only, no text. */
export const RomanChatSummarySchema = z
  .object({
    id: IdSchema,
    surface: z.enum(['client', 'coach']),
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    messageCount: z.number().int().nonnegative(),
    startedAt: IsoSchema,
    lastActivityAt: IsoSchema,
  })
  .strict();
export type RomanChatSummary = z.infer<typeof RomanChatSummarySchema> & { surface: RomanSurface };

const RomanChatPageSchema = z
  .object({
    sessions: z.array(RomanChatSummarySchema),
    nextCursor: IdSchema.nullable(),
  })
  .strict();

const RomanTranscriptMessageSchema = z
  .object({
    id: IdSchema,
    role: z.enum(['user', 'roman']),
    content: z.string(),
    interrupted: z.boolean(),
    createdAt: IsoSchema,
  })
  .strict();

const RomanTranscriptPageSchema = z
  .object({
    messages: z.array(RomanTranscriptMessageSchema),
    nextCursor: IdSchema.nullable(),
  })
  .strict();

export interface RomanChatPage {
  sessions: RomanChatSummary[];
  nextCursor: string | null;
}

export interface RomanTranscriptPage {
  /** Newest first, as the server sends them. */
  messages: RomanMessage[];
  nextCursor: string | null;
}

/**
 * Why a call did not succeed. Each reason has its own copy
 * (romanChatsCopy.ts); only `unexpected` shows a reference and goes to Sentry.
 */
export type RomanChatsFailure =
  /** No response at all: no connection or a timeout. */
  | { reason: 'offline' }
  /** 401 after the client's refresh attempt: the session has ended. */
  | { reason: 'signed_out' }
  /** 403 from the role guard: this account type cannot use Roman. */
  | { reason: 'not_allowed'; requestId: string | null }
  /** 404 ROMAN_SESSION_NOT_FOUND: no such chat for this account. */
  | { reason: 'not_found' }
  /**
   * 404 without a Roman code: the route is not there. For list and delete
   * that means a backend without #635; for reading a chat it means the Roman
   * chat switch is off on the server.
   */
  | { reason: 'route_missing' }
  /** 400 ROMAN_CURSOR_INVALID: the list is out of date. */
  | { reason: 'cursor_invalid' }
  /** 503 ROMAN_ERASE_INCOMPLETE: the erase did not finish; retry is safe. */
  | { reason: 'erase_incomplete' }
  /** 429: too many requests in a row. */
  | { reason: 'busy' }
  /** Anything else, including a response that does not match the contract. */
  | { reason: 'unexpected'; status: number | null; code: string | null; requestId: string | null };

export type RomanChatsOutcome<T> = { ok: true; value: T } | { ok: false; failure: RomanChatsFailure };

interface AxiosLikeError {
  response?: { status?: number; data?: unknown };
}

function statusOf(err: unknown): number | null {
  const s = (err as AxiosLikeError)?.response?.status;
  return typeof s === 'number' ? s : null;
}

function codeOf(err: unknown): string | null {
  const d = (err as AxiosLikeError)?.response?.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const c = (d as Record<string, unknown>).code;
  return typeof c === 'string' && c.length > 0 ? c : null;
}

/** Map a thrown request error to a failure, by status and machine code. */
export function failureOf(err: unknown): RomanChatsFailure {
  const status = statusOf(err);
  if (status === null) {
    // A response-less axios error is a network failure or timeout. Anything
    // else that is not an HTTP response is a client bug: report it.
    const isNetwork = !!err && typeof err === 'object' && 'isAxiosError' in err;
    return isNetwork
      ? { reason: 'offline' }
      : { reason: 'unexpected', status: null, code: null, requestId: null };
  }
  const code = codeOf(err);
  if (status === 401) return { reason: 'signed_out' };
  if (status === 403) return { reason: 'not_allowed', requestId: supportReferenceOf(err) };
  if (status === 404) return code === ROMAN_SESSION_NOT_FOUND ? { reason: 'not_found' } : code ? unexpected(err, status, code) : { reason: 'route_missing' };
  if (status === 400 && code === ROMAN_CURSOR_INVALID) return { reason: 'cursor_invalid' };
  if (status === 503 && code === ROMAN_ERASE_INCOMPLETE) return { reason: 'erase_incomplete' };
  if (status === 429) return { reason: 'busy' };
  return unexpected(err, status, code);
}

function unexpected(err: unknown, status: number | null, code: string | null): RomanChatsFailure {
  return { reason: 'unexpected', status, code, requestId: supportReferenceOf(err) };
}

/** A 2xx body that does not match the contract. */
function drift(res: { status?: number; headers?: unknown } | undefined): RomanChatsFailure {
  const requestId = supportReferenceOf({ response: res });
  return { reason: 'unexpected', status: res?.status ?? 200, code: 'WIRE_DRIFT', requestId };
}

export interface RomanChatsApi {
  list(opts?: { cursor?: string | null; limit?: number }): Promise<RomanChatsOutcome<RomanChatPage>>;
  deleteOne(id: string): Promise<RomanChatsOutcome<null>>;
  deleteAll(): Promise<RomanChatsOutcome<null>>;
  readMessages(id: string, opts?: { cursor?: string | null; limit?: number }): Promise<RomanChatsOutcome<RomanTranscriptPage>>;
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return ROMAN_CHATS_PAGE_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), ROMAN_CHATS_MAX_LIMIT);
}

export const romanChatsApi: RomanChatsApi = {
  async list(opts = {}) {
    const params: { limit: number; cursor?: string } = { limit: clampLimit(opts.limit) };
    if (opts.cursor) params.cursor = opts.cursor;
    try {
      const res = await api.get<unknown>('/roman/sessions', { params });
      const parsed = RomanChatPageSchema.safeParse(res?.data);
      if (!parsed.success) return { ok: false, failure: drift(res) };
      return { ok: true, value: parsed.data as RomanChatPage };
    } catch (err) {
      return { ok: false, failure: failureOf(err) };
    }
  },

  async deleteOne(id) {
    try {
      await api.delete(`/roman/sessions/${encodeURIComponent(id)}`);
      return { ok: true, value: null };
    } catch (err) {
      return { ok: false, failure: failureOf(err) };
    }
  },

  async deleteAll() {
    try {
      await api.delete('/roman/sessions');
      return { ok: true, value: null };
    } catch (err) {
      return { ok: false, failure: failureOf(err) };
    }
  },

  async readMessages(id, opts = {}) {
    const params: { limit: number; cursor?: string } = { limit: clampLimit(opts.limit) };
    if (opts.cursor) params.cursor = opts.cursor;
    try {
      const res = await api.get<unknown>(`/roman/sessions/${encodeURIComponent(id)}/messages`, { params });
      const parsed = RomanTranscriptPageSchema.safeParse(res?.data);
      if (!parsed.success) return { ok: false, failure: drift(res) };
      return {
        ok: true,
        value: {
          messages: parsed.data.messages.map((m) => ({
            id: m.id,
            role: m.role === 'roman' ? 'assistant' : 'user',
            content: m.content,
            interrupted: m.interrupted,
            createdAt: m.createdAt,
          })),
          nextCursor: parsed.data.nextCursor,
        },
      };
    } catch (err) {
      return { ok: false, failure: failureOf(err) };
    }
  },
};

export default romanChatsApi;
