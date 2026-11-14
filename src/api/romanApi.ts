/**
 * romanApi — typed mobile client for the merged Roman Phase 1 backend.
 *
 * Backend contract source of truth (binding — do NOT drift; every endpoint and
 * field below is cited file:line against the MERGED backend on main):
 *   growth-project-backend/src/roman/roman.controller.ts
 *     - POST   /roman/sessions                 openSession   (controller L60-67)
 *     - GET    /roman/sessions/:id/messages     listMessages  (controller L70-88)
 *     - POST   /roman/sessions/:id/messages     sendMessage   (controller L91-159)
 *     - DELETE /roman/sessions/:id              deleteSession (controller L162-169)
 *     - toSessionView → { id, surface, messageCount, startedAt, lastActivityAt }
 *       (controller L186-202)
 *     - toMessageView → { id, role, content, interrupted, createdAt }
 *       (controller L204-218)
 *     - list response → { messages, nextCursor } (controller L80-87)
 *   growth-project-backend/src/roman/roman.dto.ts
 *     - ROMAN_SURFACES = ['client','coach']  (dto L18)
 *     - OpenSessionDto.surface @IsIn(ROMAN_SURFACES) (dto L22-25)
 *     - SendMessageDto.content @IsString @MinLength(1) @MaxLength(8000) (dto L28-34)
 *     - ListMessagesQueryDto.cursor? string<=64, limit? int 1..100 (dto L37-53)
 *   growth-project-backend/src/roman/roman.service.ts
 *     - RomanStreamChunk { type:'delta'|'done'|'error'; text?; messageId?;
 *       interrupted? }  (service L60-69)
 *   growth-project-backend/src/roman/roman-feature.guard.ts
 *     - EVERY /roman route 404s while FEATURE_ROMAN_CHAT_ENABLED is OFF
 *       (guard L24-30) → surfaced here as a typed RomanUnavailableError.
 *
 * ─── DECLARED DEVIATION: buffered SSE read (not incremental streaming) ───────
 * The send route returns Server-Sent Events (controller L120-159). React
 * Native's `fetch` (Hermes / RN 0.85) does NOT expose a readable
 * `response.body` stream, and no streaming/EventSource transport exists in the
 * dependency set — adding one is out of lane for this slice. Rather than add an
 * undeclared dependency, we consume the SSE response with a SINGLE buffered
 * read (`response.text()`), which drains the stream to completion server-side
 * (so the assistant turn is persisted in full, never as an interrupted partial
 * — see controller L137-142 disconnect path) and then parse the SSE frames to
 * recover the terminal `done` chunk (full assistant text + persisted id). The
 * user-visible effect is that Roman's reply arrives as one settled message
 * instead of token-by-token; the wire contract, persistence, and rate-limit
 * semantics are otherwise identical. This is the brief's sanctioned fallback
 * (post-then-buffer rather than post-then-poll — no second GET is needed
 * because the buffered body already carries the terminal event). Incremental
 * token streaming is a follow-up once an RN-native SSE transport is approved.
 *
 * Wire posture:
 *   - Every response is validated with a `.strict()` Zod schema at the boundary
 *     so a shape that drifts from the backend view THROWS here (RomanWireError)
 *     instead of feeding malformed data into React state.
 *   - The send carries the draft's send-once key as the `Idempotency-Key` header when the caller gives one
 *     (SEND-ONCE-PHONE; the server's send-once rule is b#1228): a resend under the same key is answered from what
 *     the first send stored (its reply, or a coded no-reply frame), with no second model run. The body stays exactly
 *     `{ content }` (SendMessageDto is strict). A caller that gives no key sends no header.
 *   - Errors are mapped to a typed RomanApiError union: unavailable (404 /
 *     feature-off), rateLimited (uncoded 429 + retryAfterSeconds), dailyCap
 *     (429 ROMAN_RATE_LIMIT / 503 ROMAN_CAPACITY_REACHED, HTTP or in-stream:
 *     the daily AI cap pop-up, src/lib/ai/aiDailyCap.ts), offline (no network),
 *     aiRefused (R2b 403 ai_consent_required / 503 ai_egress_blocked, over HTTP
 *     or in the stream's strict { code, message } error frame), and generic. Screens render calm Roman-voiced copy off these kinds; this
 *     layer never throws a raw axios error into the UI.
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { reportWireBody, type ReportMessagePayload } from './messagesApi';
import { env } from '../config/env';
import { secureStorage } from '../services/secureStorage';
import { logger } from '../utils/logger';
import {
  RomanSafetyActionsWireSchema,
  safetyActionsConfig,
  safetyActionsHeaders,
  toSafetyActions,
  type RomanSafetyAction,
} from './romanSafetyActions';
import { captureError } from '../services/sentry';
import { romanRequiresCoachFromHttp, romanRequiresCoachOf } from '../lib/ai/romanRequiresCoach';
import {
  aiRefusalFromHttp,
  aiRefusalFromStreamCode,
  aiRefusalOf,
  type AiRefusal,
} from '../lib/ai/aiRefusal';
import {
  aiDailyCapFromHttp,
  aiDailyCapFromStreamCode,
  aiDailyCapOf,
  type AiDailyCap,
} from '../lib/ai/aiDailyCap';

// ─── Surfaces (mirror backend ROMAN_SURFACES, dto L18) ───────────────────────

export const ROMAN_SURFACES = ['client', 'coach'] as const;
export type RomanSurface = (typeof ROMAN_SURFACES)[number];

/** Hard cap on a single user turn — mirrors SendMessageDto @MaxLength (dto L33). */
export const ROMAN_MESSAGE_MAX_LENGTH = 8000;
/** Page-size ceiling — mirrors ListMessagesQueryDto @Max(100) (dto L51). */
export const ROMAN_MESSAGES_MAX_LIMIT = 100;

// ─── Response schemas (mirror backend controller views, .strict()) ───────────

/** Mirrors toSessionView (controller L186-202). */
export const RomanSessionSchema = z
  .object({
    id: z.string().min(1).max(64),
    surface: z.enum(ROMAN_SURFACES),
    messageCount: z.number().int().nonnegative(),
    startedAt: z.string().datetime({ offset: true }),
    lastActivityAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RomanSession = z.infer<typeof RomanSessionSchema>;

/**
 * WIRE roles — mirror the backend Prisma enum `RomanMessageRole { user, roman }`
 * (schema.prisma L6044-6049) exactly. The backend persists assistant turns with
 * `role: 'roman'` (roman.service.ts L437-439) and the controller emits it
 * verbatim in toMessageView (controller L213). The wire schema therefore parses
 * `'roman'` STRICTLY; any other role value is wire drift and is rejected.
 */
export const ROMAN_WIRE_MESSAGE_ROLES = ['user', 'roman'] as const;
export type RomanWireMessageRole = (typeof ROMAN_WIRE_MESSAGE_ROLES)[number];

/**
 * INTERNAL UI roles — what the rest of the app reasons about. The wire `'roman'`
 * value is mapped to the internal `'assistant'` role AFTER strict validation
 * (see `toMessage`), so UI code keeps a single stable name for Roman's turns
 * while the wire boundary stays pinned to the backend contract.
 */
export const ROMAN_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type RomanMessageRole = (typeof ROMAN_MESSAGE_ROLES)[number];

/** Map a validated wire role to the internal UI role. */
function toUiRole(wire: RomanWireMessageRole): RomanMessageRole {
  return wire === 'roman' ? 'assistant' : 'user';
}

/** Mirrors toMessageView (controller L204-218) — wire shape, strict. */
export const RomanWireMessageSchema = z
  .object({
    id: z.string().min(1).max(64),
    role: z.enum(ROMAN_WIRE_MESSAGE_ROLES),
    content: z.string(),
    interrupted: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    safety_actions: RomanSafetyActionsWireSchema,
  })
  .strict();
export type RomanWireMessage = z.infer<typeof RomanWireMessageSchema>;

/** The internal message shape consumed by the UI (role mapped from the wire). */
export interface RomanMessage {
  id: string;
  role: RomanMessageRole;
  content: string;
  interrupted: boolean;
  createdAt: string;
  /** CRISIS-BTN: set only on a reply the server marked (Roman's fixed crisis reply). */
  safetyActions?: RomanSafetyAction[];
}

/** Validate + map a single wire message into the internal UI shape. */
function toMessage(wire: RomanWireMessage): RomanMessage {
  const safetyActions = toSafetyActions(wire.safety_actions);
  return {
    id: wire.id,
    role: toUiRole(wire.role),
    content: wire.content,
    interrupted: wire.interrupted,
    createdAt: wire.createdAt,
    ...(safetyActions ? { safetyActions } : {}),
  };
}

/** Mirrors the list response (controller L80-87) — wire shape, strict. */
export const RomanWireMessagePageSchema = z
  .object({
    messages: z.array(RomanWireMessageSchema),
    nextCursor: z.string().max(64).nullable(),
  })
  .strict();
export type RomanWireMessagePage = z.infer<typeof RomanWireMessagePageSchema>;

/** The internal page shape: messages mapped to the UI role. */
export interface RomanMessagePage {
  messages: RomanMessage[];
  nextCursor: string | null;
}

/** Mirrors RomanStreamChunk (service L60-69). */
export const RomanStreamChunkSchema = z
  .object({
    type: z.enum(['delta', 'done', 'error']),
    text: z.string().optional(),
    messageId: z.string().min(1).max(64).optional(),
    interrupted: z.boolean().optional(),
    safety_actions: RomanSafetyActionsWireSchema,
    /** COPILOT-M2: present only when the Path Copilot surface sent x-roman-copilot (parsed by copilotApi). */
    copilot: z.unknown().optional(),
  })
  .strict();
export type RomanStreamChunk = z.infer<typeof RomanStreamChunkSchema>;

/** Mirrors the structured SSE error event body (controller L150-153). */
export const RomanStreamErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .strict();
export type RomanStreamError = z.infer<typeof RomanStreamErrorSchema>;

// ─── Typed error union ───────────────────────────────────────────────────────

export type RomanErrorKind =
  | 'unavailable' // 404 — feature flag off OR session not found / not owned
  | 'rateLimited' // uncoded 429 — burst throttle
  | 'dailyCap' // 429 ROMAN_RATE_LIMIT / 503 ROMAN_CAPACITY_REACHED — daily cap pop-up
  | 'offline' // no network reachability
  | 'aiRefused' // R2b: 403 ai_consent_required / 503 ai_egress_blocked (HTTP or in-stream)
  | 'poolEmpty' // 402 COACH_AI_BUDGET_EXHAUSTED: the coach's monthly AI credit pool is used up
  | 'requiresCoach' // 403 ROMAN_REQUIRES_COACH: a client with no coach (shows "Join a coach")
  | 'generic'; // anything else (5xx, malformed, unknown)

export class RomanApiError extends Error {
  readonly kind: RomanErrorKind;
  /** Present only for `rateLimited`; seconds the caller should wait. */
  readonly retryAfterSeconds?: number;
  /** Present only for `aiRefused`: which refusal, with its support reference. */
  readonly refusal?: AiRefusal;
  /**
   * True when the failure came AFTER the server accepted the send (HTTP 200):
   * the backend stores the user turn before it opens the stream, so the turn
   * is already saved even though no answer came (Sol B-326-3). The client must
   * keep it and must never append it again on its own.
   */
  readonly turnStored: boolean;
  /** Present only for `dailyCap`: when AI help resets. */
  readonly dailyCap?: AiDailyCap;
  /**
   * ROMAN-PENDING-WORDS-M: true only on the exact ROMAN_REPLY_PENDING frame (Roman is still writing the first answer),
   * so a screen can say so instead of "could not answer". Kind, words and `turnStored` are those of any coded frame.
   */
  readonly replyPending?: true;

  constructor(
    kind: RomanErrorKind,
    message: string,
    retryAfterSeconds?: number,
    refusal?: AiRefusal,
    turnStored = false,
    dailyCap?: AiDailyCap,
  ) {
    super(message);
    this.name = 'RomanApiError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
    this.refusal = refusal;
    this.turnStored = turnStored;
    this.dailyCap = dailyCap;
  }
}

/**
 * SEND-ONCE-PHONE (b#1228): a RomanApiError the server answered so that a resend under the same Idempotency-Key could
 * only repeat it: a 400 or 409 before the stream, or a coded frame after it opened (the turn is stored with no reply,
 * and the server replays "no reply" for that key), except ROMAN_REPLY_PENDING (the first send may still store its
 * reply, so the key stays). The next send of these words makes a new key, so Send again asks once more. Same kind,
 * words and fields as the RomanApiError it is; only the send-once key reads the mark.
 */
export class RomanKeySpentError extends RomanApiError {
  readonly sendOnceKeySpent = true;
}

/** ROMAN-PENDING-WORDS-M: the ROMAN_REPLY_PENDING frame's error; read by its field, `replyPending`. */
class RomanReplyPendingError extends RomanApiError {
  readonly replyPending = true as const;
}

/** Read a non-2xx body as JSON when it is JSON; never throws. */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** The X-Request-ID the backend stamped on this response (the support reference). */
function responseRequestId(response: Response): string | null {
  const v = response.headers?.get?.('x-request-id');
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Thrown when a backend response shape drifts from the cited contract. */
export class RomanWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RomanWireError';
  }
}

// ─── Error mapping ─────────────────────────────────────────────────────────

function parseRetryAfter(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  }
  return undefined;
}

const ROMAN_DAILY_CAP_MESSAGE = 'Daily AI limit reached.';

/** Backend B-668-1 machine code: the coach's monthly AI credit pool is used up (402). */
export const COACH_AI_BUDGET_EXHAUSTED_CODE = 'COACH_AI_BUDGET_EXHAUSTED';
/**
 * Backend SEND-ONCE-PENDING-BE in-stream code (roman.constants.ts:75 at backend main f239683f): a same-key resend while
 * the first send may still store its reply. Same words as ROMAN_UNAVAILABLE; the send-once key stays with the draft.
 */
export const ROMAN_REPLY_PENDING_CODE = 'ROMAN_REPLY_PENDING';
const ROMAN_POOL_EMPTY_MESSAGE = 'AI credits used up for this month.';
const ROMAN_REQUIRES_COACH_MESSAGE = 'Roman works with a coach.';

function isPoolEmptyBody(body: unknown): boolean {
  return (
    !!body &&
    typeof body === 'object' &&
    (body as { code?: unknown }).code === COACH_AI_BUDGET_EXHAUSTED_CODE
  );
}

/** Map any thrown error (axios or otherwise) to a typed RomanApiError. */
function toRomanApiError(err: unknown): RomanApiError {
  if (err instanceof RomanApiError) return err;
  if (axios.isAxiosError(err)) {
    if (err.response) {
      const status = err.response.status;
      const dailyCap = aiDailyCapOf(err);
      if (dailyCap) {
        return new RomanApiError('dailyCap', ROMAN_DAILY_CAP_MESSAGE, undefined, undefined, false, dailyCap);
      }
      if (romanRequiresCoachOf(err)) {
        return new RomanApiError('requiresCoach', ROMAN_REQUIRES_COACH_MESSAGE);
      }
      if (status === 404) {
        return new RomanApiError(
          'unavailable',
          'Roman is not available right now.',
        );
      }
      if (status === 429) {
        const headerRetry = parseRetryAfter(err.response.headers?.['retry-after']);
        const bodyRetry = parseRetryAfter(
          (err.response.data as { retryAfterSeconds?: unknown } | undefined)
            ?.retryAfterSeconds,
        );
        return new RomanApiError(
          'rateLimited',
          'Roman needs a brief moment before the next message.',
          headerRetry ?? bodyRetry,
        );
      }
      const refusal = aiRefusalOf(err);
      if (refusal) {
        return new RomanApiError('aiRefused', 'Roman cannot answer this request.', undefined, refusal);
      }
      return new RomanApiError('generic', 'That request did not complete.');
    }
    // No response object → network/timeout (offline).
    return new RomanApiError('offline', 'No connection to Roman right now.');
  }
  return new RomanApiError('generic', 'That request did not complete.');
}

// ─── REST: open/resume, list, delete ─────────────────────────────────────────

/**
 * POST /roman/sessions — open or resume the caller's session for a surface.
 * Idempotent on the backend day-key (controller L60-67), so a repeat open on
 * the same day resumes the same session rather than creating a new one.
 */
export async function openOrResumeSession(
  surface: RomanSurface,
): Promise<RomanSession> {
  try {
    const res = await api.post('/roman/sessions', { surface });
    const parsed = RomanSessionSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new RomanWireError(
        `roman session response drifted from contract: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof RomanWireError) throw err;
    throw toRomanApiError(err);
  }
}

/**
 * GET /roman/sessions/:id/messages — newest-first page (controller L70-88).
 * `cursor` is the opaque id of the oldest message already seen; `limit` is
 * clamped to the backend ceiling so we never send an over-cap query.
 */
export async function listMessages(
  sessionId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<RomanMessagePage> {
  const params: { cursor?: string; limit?: number } = {};
  if (opts.cursor != null && opts.cursor !== '') params.cursor = opts.cursor;
  if (opts.limit != null) {
    params.limit = Math.min(Math.max(1, Math.trunc(opts.limit)), ROMAN_MESSAGES_MAX_LIMIT);
  }
  try {
    const res = await api.get(`/roman/sessions/${encodeURIComponent(sessionId)}/messages`, {
      params,
      ...safetyActionsConfig(),
    });
    const parsed = RomanWireMessagePageSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new RomanWireError(
        `roman messages response drifted from contract: ${parsed.error.message}`,
      );
    }
    // Map the validated wire roles ('roman') to the internal UI role
    // ('assistant') AFTER the strict boundary, never before.
    return {
      messages: parsed.data.messages.map(toMessage),
      nextCursor: parsed.data.nextCursor,
    };
  } catch (err) {
    if (err instanceof RomanWireError) throw err;
    throw toRomanApiError(err);
  }
}

/** DELETE /roman/sessions/:id: erases the chat (backend #635; 204, repeat is a quiet 204). */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await api.delete(`/roman/sessions/${encodeURIComponent(sessionId)}`);
  } catch (err) {
    throw toRomanApiError(err);
  }
}

/** The answer to POST /roman/messages/:id/report (backend #1223). */
export interface RomanReportResult {
  reportId: string;
  status: 'received' | 'already_reported';
}

const RomanReportResultSchema = z.object({
  reportId: z.string(),
  status: z.enum(['received', 'already_reported']),
});

/**
 * POST /roman/messages/:id/report (backend #1223, ROMAN-HOLD-M): report one of
 * Roman's replies to TGP's team. Same body as the DM report (reason list and
 * 1000-character details). One report per person and reply: a second send
 * answers `already_reported` with the first id, so a retry never files twice.
 */
export async function reportMessage(
  messageId: string,
  payload: ReportMessagePayload,
): Promise<RomanReportResult> {
  if (!messageId) throw new Error('messageId required');
  let data: unknown;
  try {
    const res = await api.post(`/roman/messages/${encodeURIComponent(messageId)}/report`, reportWireBody(payload));
    data = res.data;
  } catch (err) {
    throw toRomanApiError(err);
  }
  const parsed = RomanReportResultSchema.safeParse(data);
  if (!parsed.success) throw new RomanWireError('POST /roman/messages/:id/report: unexpected response shape');
  return parsed.data;
}

// ─── SSE: send a turn, buffer the reply (DECLARED DEVIATION — see header) ────

/** The settled assistant turn recovered from the buffered SSE stream. */
export interface RomanAssistantReply {
  /** Full assistant text (terminal `done` chunk text, service L446-451). */
  text: string;
  /** Persisted assistant message id (present on `done`, service L449). */
  messageId?: string;
  /** True when the backend persisted a partial (interrupted) turn. */
  interrupted: boolean;
  /** CRISIS-BTN: the server marker on the `done` chunk of the fixed crisis reply. */
  safetyActions?: RomanSafetyAction[];
  /** COPILOT-M2: the raw `copilot` field of the done frame (Path Copilot surface only). */
  copilot?: unknown;
}

/**
 * Parse a buffered SSE body into ordered chunks. Recognises both the
 * `data: {json}` frames the controller writes for normal chunks (controller
 * L143) and the `event: error\ndata: {json}` frame it writes on failure
 * (controller L150-153). Frames are separated by a blank line.
 */
export function parseSseChunks(
  body: string,
): { chunks: RomanStreamChunk[]; streamError?: RomanStreamError } {
  const chunks: RomanStreamChunk[] = [];
  let streamError: RomanStreamError | undefined;
  const frames = body.split(/\n\n/);
  for (const frame of frames) {
    const trimmed = frame.trim();
    if (trimmed === '') continue;
    let isErrorEvent = false;
    const dataLines: string[] = [];
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('event:')) {
        if (line.slice('event:'.length).trim() === 'error') isErrorEvent = true;
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }
    if (dataLines.length === 0) continue;
    let json: unknown;
    try {
      json = JSON.parse(dataLines.join('\n'));
    } catch {
      // A non-JSON data frame is contract drift. Surface it as a typed wire
      // error rather than silently discarding it — a malformed frame before a
      // later `done` must NOT be treated as success (R1 code finding F6).
      throw new RomanWireError(
        'roman stream carried a non-JSON data frame',
      );
    }
    if (isErrorEvent) {
      const parsed = RomanStreamErrorSchema.safeParse(json);
      if (!parsed.success) {
        throw new RomanWireError(
          `roman stream error frame drifted from contract: ${parsed.error.message}`,
        );
      }
      streamError = parsed.data;
      continue;
    }
    const parsed = RomanStreamChunkSchema.safeParse(json);
    if (!parsed.success) {
      throw new RomanWireError(
        `roman stream chunk drifted from contract: ${parsed.error.message}`,
      );
    }
    chunks.push(parsed.data);
  }
  return { chunks, streamError };
}

/**
 * POST /roman/sessions/:id/messages — persist the user turn and return Roman's
 * settled reply. See the DECLARED DEVIATION in the file header: we read the SSE
 * response as a single buffered body (RN has no streaming `response.body`),
 * then recover the terminal `done` chunk.
 *
 * Uses the same base URL + bearer token as the shared axios client so auth and
 * environment parity are preserved; axios is bypassed ONLY here because we need
 * the raw text body of an event-stream response.
 */
export async function sendMessage(
  sessionId: string,
  content: string,
  opts: { copilot?: boolean; idempotencyKey?: string } = {},
): Promise<RomanAssistantReply> {
  const token = await secureStorage.getItem('supabase_token');
  const url = `${env.API_URL}/roman/sessions/${encodeURIComponent(sessionId)}/messages`;

  const controller = new AbortController();
  // Fail fast rather than hang on a wedged stream (FIFTY_FAILURES #35).
  const timeout = setTimeout(() => controller.abort(), 60000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...safetyActionsHeaders(),
        // COPILOT-M2: only the Path Copilot surface opts in (b#1129 contract).
        ...(opts.copilot ? { 'x-roman-copilot': '1' } : {}),
        // SEND-ONCE-PHONE: the draft's send-once key, a header only (never a body field).
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    // AbortError (timeout) or a transport failure → treated as offline; the
    // composer preserves the message so the user can retry.
    logger.warn('romanApi.sendMessage transport', err);
    throw new RomanApiError('offline', 'No connection to Roman right now.');
  }

  // Set once the server answered 200: from then on the user turn is stored.
  let accepted = false;
  try {
    if (!response.ok) {
      if (response.status === 404) {
        throw new RomanApiError('unavailable', 'Roman is not available right now.');
      }
      const coded =
        response.status === 402 ||
        response.status === 429 ||
        response.status === 403 ||
        response.status === 503;
      const errorBody = coded ? await readErrorBody(response) : null;
      // The coach's monthly AI credit pool is used up (backend B-668-1),
      // before the turn is stored: its own copy, never a retryable error.
      if (response.status === 402 && isPoolEmptyBody(errorBody)) {
        throw new RomanApiError('poolEmpty', ROMAN_POOL_EMPTY_MESSAGE);
      }
      // A client with no coach, before the turn is stored: the locked state.
      if (romanRequiresCoachFromHttp(response.status, errorBody)) {
        throw new RomanApiError('requiresCoach', ROMAN_REQUIRES_COACH_MESSAGE);
      }
      if (response.status === 429 || response.status === 503) {
        // Daily AI cap (429 ROMAN_RATE_LIMIT / 503 ROMAN_CAPACITY_REACHED),
        // before the turn is stored: the pop-up, never a generic error.
        const dailyCap = aiDailyCapFromHttp(
          response.status,
          errorBody,
          parseRetryAfter(response.headers.get('retry-after')),
        );
        if (dailyCap) {
          throw new RomanApiError('dailyCap', ROMAN_DAILY_CAP_MESSAGE, undefined, undefined, false, dailyCap);
        }
      }
      if (response.status === 429) {
        const retry = parseRetryAfter(response.headers.get('retry-after'));
        throw new RomanApiError(
          'rateLimited',
          'Roman needs a brief moment before the next message.',
          retry,
        );
      }
      // R2b: 403 ai_consent_required (before the turn is stored) and 503
      // ai_egress_blocked are specific, actionable refusals, read from the
      // status AND the machine code.
      if (response.status === 403 || response.status === 503) {
        const refusal = aiRefusalFromHttp(
          response.status,
          errorBody,
          responseRequestId(response),
        );
        if (refusal) {
          throw new RomanApiError('aiRefused', 'Roman cannot answer this request.', undefined, refusal);
        }
      }
      if (response.status === 400 || response.status === 409) {
        // SEND-ONCE-PHONE: the server read this send and refused it (409: the key is spent on other words).
        throw new RomanKeySpentError('generic', 'That request did not complete.');
      }
      throw new RomanApiError('generic', 'That request did not complete.');
    }

    accepted = true;
    const bodyText = await response.text();
    const { chunks, streamError } = parseSseChunks(bodyText);

    if (streamError) {
      // Structured in-stream error (e.g. ROMAN_UNAVAILABLE, controller L152). SEND-ONCE-PHONE: each but
      // ROMAN_REPLY_PENDING is a RomanKeySpentError: the turn is stored with no reply, and a same-key resend would
      // only replay that. ROMAN_REPLY_PENDING says the first send may still store its reply: the key stays.
      // R2b: a consent / egress refusal mid-request keeps its code; the
      // reference is the stream response's X-Request-ID header (the frame
      // itself is exactly { code, message }, backend B-626-2).
      const refusal = aiRefusalFromStreamCode(streamError, responseRequestId(response));
      if (refusal) {
        if (refusal.kind === 'egress_blocked') {
          // C-326-3: an in-stream egress block is a server-side defect the
          // backend does not report on this path; report it once, with the
          // reference the person sees.
          captureError(new Error('roman in-stream ai_egress_blocked'), {
            surface: 'roman',
            reference: refusal.reference,
          });
        }
        throw new RomanKeySpentError('aiRefused', streamError.message, undefined, refusal, true);
      }
      // The spend cap reached after the turn was stored (reserveDailySpend):
      // the turn stays, and the daily cap pop-up explains why no answer came.
      const dailyCap = aiDailyCapFromStreamCode(streamError.code);
      if (dailyCap) {
        throw new RomanKeySpentError('dailyCap', ROMAN_DAILY_CAP_MESSAGE, undefined, undefined, true, dailyCap);
      }
      if (streamError.code === COACH_AI_BUDGET_EXHAUSTED_CODE) {
        throw new RomanKeySpentError('poolEmpty', ROMAN_POOL_EMPTY_MESSAGE, undefined, undefined, true);
      }
      if (streamError.code === ROMAN_REPLY_PENDING_CODE) {
        // FIX-953R3 (LS-953R2 B2): Roman is still writing the first answer. The same kind, words and turnStored as any
        // other code, without the key-spent mark, so Send again replays the stored answer instead of storing the
        // question a second time; `replyPending` lets the screens say so (ROMAN-PENDING-WORDS-M).
        throw new RomanReplyPendingError('generic', streamError.message, undefined, undefined, true);
      }
      const kind: RomanErrorKind =
        streamError.code === 'ROMAN_UNAVAILABLE' ? 'unavailable' : 'generic';
      throw new RomanKeySpentError(kind, streamError.message, undefined, undefined, true);
    }

    const done = chunks.find((c) => c.type === 'done');
    if (!done) {
      // No terminal frame in a 200 body is a contract drift.
      throw new RomanWireError(
        'roman stream completed without a terminal `done` chunk',
      );
    }
    const safetyActions = toSafetyActions(done.safety_actions);
    return {
      text: done.text ?? '',
      messageId: done.messageId,
      interrupted: done.interrupted === true,
      ...(safetyActions ? { safetyActions } : {}),
      ...(done.copilot != null ? { copilot: done.copilot } : {}),
    };
  } catch (err) {
    if (err instanceof RomanApiError || err instanceof RomanWireError) throw err;
    const mapped = toRomanApiError(err);
    // A failure while reading an accepted (200) stream: the turn is stored.
    if (accepted) {
      throw new RomanApiError(
        mapped.kind,
        mapped.message,
        mapped.retryAfterSeconds,
        mapped.refusal,
        true,
        mapped.dailyCap,
      );
    }
    throw mapped;
  } finally {
    clearTimeout(timeout);
  }
}
