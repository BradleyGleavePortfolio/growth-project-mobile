/**
 * communityVoiceApi — typed client for the v3-3 Community Voice Notes backend
 * (audio attachments into cohort / workspace-hall channels and DM threads).
 *
 * Backend contract source of truth (do not drift):
 *   growth-project-backend/src/community/voice/community-voice.controller.ts
 *   growth-project-backend/src/community/voice/community-voice.dto.ts
 *
 * Wire posture mirrors communityClassroomApi.ts / communityChallengesApi.ts:
 *   - Every response is validated with Zod at the boundary so a drifted shape
 *     THROWS here (wrapped as a `contract` error) instead of feeding malformed
 *     data into React state.
 *   - The feed read is cursor-paginated: the response carries `next_cursor`
 *     (the note id to pass back as `cursor` for the next page; null on the last
 *     page), so the screen pages with useInfiniteQuery and never requests an
 *     unbounded result set.
 *   - The download `url` is a time-limited signed GET minted server-side at
 *     read time; it is nullable so a note whose storage is unconfigured
 *     degrades to a disabled player rather than a broken link.
 *   - The publish flow is a two-hop, server-authoritative pipeline:
 *       1. issueUploadUrl(...) validates duration/size/mime and mints a signed
 *          PUT target + the opaque `storage_key` (namespaced to the caller).
 *       2. the client PUTs the audio bytes directly to `upload_url`.
 *       3. create(...) durably records the note, re-asserting the same limits
 *          and the `${userId}/` bucket binding. The client is NEVER trusted on
 *          the second hop either — the server re-derives the namespace.
 *     The waveform is a CLIENT-SIDE visualization only; the backend does not
 *     accept waveform peaks on create (it stores null and reports
 *     `has_waveform`), so this client intentionally does not send them.
 *
 * Limits mirror the backend DTO constants exactly so the recorder/composer can
 * pre-validate before a round-trip; the server remains authoritative.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { CommunityApiError } from './communityApi';

// ─── Server limits (mirror backend community-voice.dto.ts) ───────────────────

/** Max voice duration — 300000 ms / 5 min. */
export const MAX_VOICE_DURATION_MS = 300_000;
/** Min positive duration — a 0/negative duration is never a real recording. */
export const MIN_VOICE_DURATION_MS = 1;
/** Max voice payload size — 25 MB. */
export const MAX_VOICE_BYTES = 25_000_000;

/**
 * The four allowed voice MIME types (mirror backend allowlist). The mobile
 * recorder produces audio/mp4 (iOS) or audio/aac / audio/webm (Android); wav
 * is accepted for completeness. A type outside this set is rejected client-side
 * before any signed URL is requested, and again server-side.
 */
export const VOICE_NOTE_MIME_ALLOWLIST = [
  'audio/mp4',
  'audio/aac',
  'audio/webm',
  'audio/wav',
] as const;
export type VoiceNoteMimeType = (typeof VOICE_NOTE_MIME_ALLOWLIST)[number];

/** Defensive page size for the voice-note list read (bounded). */
export const VOICE_PAGE_LIMIT = 20;

// ─── Response schemas (mirror backend Zod, snake_case wire shape) ────────────

export const VoiceUploadTargetSchema = z
  .object({
    upload_url: z.string(),
    storage_key: z.string(),
    expires_at: z.string(),
    expires_in_seconds: z.number().int(),
    bucket: z.string(),
  })
  .strict();
export type VoiceUploadTarget = z.infer<typeof VoiceUploadTargetSchema>;

export const VoiceNoteViewSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    cohort_id: z.string().nullable(),
    conversation_id: z.string().nullable(),
    author_id: z.string(),
    /**
     * Time-limited signed GET URL for the audio object, or null when signing is
     * unavailable (storage not configured). The player renders a disabled state
     * rather than a broken control when null.
     */
    url: z.string().nullable(),
    duration_ms: z.number().int(),
    bytes: z.number().int(),
    mime_type: z.string(),
    /** Whether the server stored waveform peaks (currently always false). */
    has_waveform: z.boolean(),
    created_at: z.string(),
  })
  .strict();
export type VoiceNoteView = z.infer<typeof VoiceNoteViewSchema>;

const VoiceNoteResponseSchema = z
  .object({ voice_note: VoiceNoteViewSchema })
  .strict();

const VoiceNoteFeedResponseSchema = z
  .object({
    voice_notes: z.array(VoiceNoteViewSchema),
    /** Page cursor: id of the last note when more remain, else null. */
    next_cursor: z.string().nullable(),
  })
  .strict();
export type VoiceNoteFeedPage = z.infer<typeof VoiceNoteFeedResponseSchema>;

const VoiceDeleteResponseSchema = z.object({ deleted: z.literal(true) }).strict();
export type VoiceDeleteResult = z.infer<typeof VoiceDeleteResponseSchema>;

// ─── Transport helper (mirrors communityClassroomApi.call) ───────────────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/** External-fetch timeout (every network read carries an AbortSignal.timeout). */
export const VOICE_REQUEST_TIMEOUT_MS = 15_000;
/** The raw byte upload can be larger/slower than a JSON call. */
export const VOICE_UPLOAD_TIMEOUT_MS = 60_000;

async function call<T>(
  schema: z.ZodType<T>,
  fn: () => Promise<{ data: unknown }>,
): Promise<T> {
  let res: { data: unknown };
  try {
    res = await fn();
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 0;
      throw new CommunityApiError(
        classify(status),
        status,
        `community voice request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'community voice request failed',
      err,
    );
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CommunityApiError(
        'contract',
        200,
        'voice-note response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

// ─── Request payloads (mirror backend DTOs) ──────────────────────────────────

export interface IssueVoiceUploadInput {
  duration_ms: number;
  bytes: number;
  mime_type: VoiceNoteMimeType;
}

export interface CreateVoiceNoteInput {
  /** The opaque storage key returned by issueUploadUrl. */
  storage_key: string;
  duration_ms: number;
  bytes: number;
  mime_type: VoiceNoteMimeType;
  /** Optional cohort target; omitted (with no conversation) → workspace hall. */
  cohortId?: string;
  /** Optional DM conversation target. */
  conversationId?: string;
}

export interface VoiceFeedParams {
  /** Maximum notes to request for this page. */
  limit?: number;
  /** Opaque forward cursor for the next page (omitted on the first page). */
  cursor?: string;
  /** Optional cohort scope. */
  cohortId?: string;
  /** Optional DM conversation scope. */
  conversationId?: string;
}

function feedParams(opts: VoiceFeedParams): Record<string, string> {
  const params: Record<string, string> = {};
  const limit = opts.limit ?? VOICE_PAGE_LIMIT;
  if (Number.isFinite(limit) && limit > 0) params.limit = String(limit);
  if (opts.cursor) params.cursor = opts.cursor;
  if (opts.cohortId) params.cohort_id = opts.cohortId;
  if (opts.conversationId) params.conversation_id = opts.conversationId;
  return params;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const communityVoiceApi = {
  /**
   * POST /community/workspaces/:workspaceId/voice-notes/upload-url
   *
   * Validates duration/size/mime and mints a signed PUT target plus the opaque
   * `storage_key` (namespaced to the caller). No row is created yet.
   */
  issueUploadUrl(
    workspaceId: string,
    input: IssueVoiceUploadInput,
  ): Promise<VoiceUploadTarget> {
    return call(VoiceUploadTargetSchema, () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/voice-notes/upload-url`,
        input,
        { signal: AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS) },
      ),
    );
  },

  /**
   * Direct binary PUT of the recorded audio to the signed upload URL. Returns
   * nothing on success; a transport failure is surfaced as a typed
   * CommunityApiError so the composer can offer a retry without losing the
   * recording.
   */
  async uploadBytes(
    uploadUrl: string,
    body: Blob | ArrayBuffer,
    mimeType: VoiceNoteMimeType,
  ): Promise<void> {
    try {
      // The signed URL is an absolute storage endpoint, not an API route, so
      // we use a bare axios PUT (not the `api` instance with its auth/baseURL).
      await axios.put(uploadUrl, body, {
        headers: { 'Content-Type': mimeType },
        signal: AbortSignal.timeout(VOICE_UPLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? 0;
        throw new CommunityApiError(
          classify(status),
          status,
          `voice upload failed (${status || 'network'})`,
          err,
        );
      }
      throw new CommunityApiError('unknown', -1, 'voice upload failed', err);
    }
  },

  /**
   * POST /community/workspaces/:workspaceId/voice-notes
   *
   * Durably records the note after its bytes are uploaded. The server re-asserts
   * the limits and the `${userId}/` bucket binding on `storage_key`.
   */
  create(
    workspaceId: string,
    input: CreateVoiceNoteInput,
  ): Promise<VoiceNoteView> {
    const body: Record<string, unknown> = {
      storage_key: input.storage_key,
      duration_ms: input.duration_ms,
      bytes: input.bytes,
      mime_type: input.mime_type,
    };
    if (input.cohortId) body.cohort_id = input.cohortId;
    if (input.conversationId) body.conversation_id = input.conversationId;
    return call(VoiceNoteResponseSchema, () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/voice-notes`,
        body,
        { signal: AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS) },
      ),
    ).then((r) => r.voice_note);
  },

  /**
   * GET /community/workspaces/:workspaceId/voice-notes
   *
   * The bounded, cursor-paged feed of voice notes the caller can see, newest
   * first. RLS + the service scope the rows; the client renders what it gets.
   */
  listFeed(
    workspaceId: string,
    opts: VoiceFeedParams = {},
  ): Promise<VoiceNoteFeedPage> {
    return call(VoiceNoteFeedResponseSchema, () =>
      api.get<unknown>(`/community/workspaces/${workspaceId}/voice-notes`, {
        params: feedParams(opts),
        signal: AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS),
      }),
    );
  },

  /**
   * GET /community/voice-notes/:voiceNoteId
   *
   * A single note with its signed download URL. A non-visible note is a 404
   * server-side (existence never leaks), surfaced here as a typed error the
   * screen renders as a calm not-found.
   */
  getOne(voiceNoteId: string): Promise<VoiceNoteView> {
    return call(VoiceNoteResponseSchema, () =>
      api.get<unknown>(`/community/voice-notes/${voiceNoteId}`, {
        signal: AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS),
      }),
    ).then((r) => r.voice_note);
  },

  /**
   * DELETE /community/voice-notes/:voiceNoteId
   *
   * Retract a note (author or coach). Returns `{ deleted: true }`.
   */
  remove(voiceNoteId: string): Promise<VoiceDeleteResult> {
    return call(VoiceDeleteResponseSchema, () =>
      api.delete<unknown>(`/community/voice-notes/${voiceNoteId}`, {
        signal: AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS),
      }),
    );
  },
};

export type CommunityVoiceApi = typeof communityVoiceApi;
