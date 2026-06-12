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
 *   - The send mutation carries no idempotency header: the merged backend send
 *     route (controller L91-119) and SendMessageDto (dto L28-35) accept only
 *     `content` and never read an idempotency header, so the client does not
 *     send one and never presents a retry as duplicate-safe.
 *   - Errors are mapped to a typed RomanApiError union: unavailable (404 /
 *     feature-off), rateLimited (429 + retryAfterSeconds), offline (no network),
 *     and generic. Screens render calm Roman-voiced copy off these kinds; this
 *     layer never throws a raw axios error into the UI.
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { env } from '../config/env';
import { secureStorage } from '../services/secureStorage';
import { logger } from '../utils/logger';

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
    id: z.string().uuid(),
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
    id: z.string().uuid(),
    role: z.enum(ROMAN_WIRE_MESSAGE_ROLES),
    content: z.string(),
    interrupted: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
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
}

/** Validate + map a single wire message into the internal UI shape. */
function toMessage(wire: RomanWireMessage): RomanMessage {
  return {
    id: wire.id,
    role: toUiRole(wire.role),
    content: wire.content,
    interrupted: wire.interrupted,
    createdAt: wire.createdAt,
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
    messageId: z.string().uuid().optional(),
    interrupted: z.boolean().optional(),
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
  | 'rateLimited' // 429 — @Throttle / per-tier cap
  | 'offline' // no network reachability
  | 'generic'; // anything else (5xx, malformed, unknown)

export class RomanApiError extends Error {
  readonly kind: RomanErrorKind;
  /** Present only for `rateLimited`; seconds the caller should wait. */
  readonly retryAfterSeconds?: number;

  constructor(kind: RomanErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'RomanApiError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
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

/** Map any thrown error (axios or otherwise) to a typed RomanApiError. */
function toRomanApiError(err: unknown): RomanApiError {
  if (err instanceof RomanApiError) return err;
  if (axios.isAxiosError(err)) {
    if (err.response) {
      const status = err.response.status;
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

/** DELETE /roman/sessions/:id — soft-delete (controller L162-169, 204 No Content). */
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await api.delete(`/roman/sessions/${encodeURIComponent(sessionId)}`);
  } catch (err) {
    throw toRomanApiError(err);
  }
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

  try {
    if (!response.ok) {
      if (response.status === 404) {
        throw new RomanApiError('unavailable', 'Roman is not available right now.');
      }
      if (response.status === 429) {
        const retry = parseRetryAfter(response.headers.get('retry-after'));
        throw new RomanApiError(
          'rateLimited',
          'Roman needs a brief moment before the next message.',
          retry,
        );
      }
      throw new RomanApiError('generic', 'That request did not complete.');
    }

    const bodyText = await response.text();
    const { chunks, streamError } = parseSseChunks(bodyText);

    if (streamError) {
      // Structured in-stream error (e.g. ROMAN_UNAVAILABLE, controller L152).
      const kind: RomanErrorKind =
        streamError.code === 'ROMAN_UNAVAILABLE' ? 'unavailable' : 'generic';
      throw new RomanApiError(kind, streamError.message);
    }

    const done = chunks.find((c) => c.type === 'done');
    if (!done) {
      // No terminal frame in a 200 body is a contract drift.
      throw new RomanWireError(
        'roman stream completed without a terminal `done` chunk',
      );
    }
    return {
      text: done.text ?? '',
      messageId: done.messageId,
      interrupted: done.interrupted === true,
    };
  } catch (err) {
    if (err instanceof RomanApiError || err instanceof RomanWireError) throw err;
    throw toRomanApiError(err);
  } finally {
    clearTimeout(timeout);
  }
}
