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
 *   - Voice notes Studio (backend #1122, live) adds six view keys and optional
 *     create `waveform_peaks`; the view keys stay optional so an older note parses.
 *
 * Limits mirror the backend DTO constants exactly so the recorder/composer can
 * pre-validate before a round-trip; the server remains authoritative.
 */
import { z } from 'zod';
import axios from 'axios';
import api, { type BoundRequestConfig } from '../services/api';
import { boundRequestSignal, type AccountBinding } from '../services/accountBinding';
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

/**
 * Who removed a voice note for everyone: the space's coach or the platform owner (always shown as the
 * coach). `name` is the name this viewer sees for that coach here (the author_name rule).
 */
export const VoiceRemovedBySchema = z
  .object({
    role: z.literal('coach'),
    user_id: z.string(),
    name: z.string(),
  })
  .strict();
export type VoiceRemovedBy = z.infer<typeof VoiceRemovedBySchema>;

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
    /** Whether the server stored waveform peaks. */
    has_waveform: z.boolean(),
    created_at: z.string(),
    // Studio keys (backend #1122; OPERATOR RULING 6304777236), optional so an older server still parses.
    author_name: z.string().optional(),
    author_is_coach: z.boolean().optional(),
    waveform_peaks: z.array(z.number()).nullable().optional(),
    heard_at: z.string().nullable().optional(),
    message_id: z.string().nullable().optional(),
    parent_message_id: z.string().nullable().optional(),
    // A coach removal (backend #1165 CONTRACT 6405215872): the note keeps its place with every audio
    // field emptied and these two keys; live rows never carry them (absent, not null).
    removed_at: z.string().optional(),
    removed_by: VoiceRemovedBySchema.optional(),
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

/** The server's peak cap (backend #1122 = the recorder's MAX_PEAKS). */
export const MAX_WAVEFORM_PEAKS = 64;

/** Peaks the server accepts: 1..64 finite numbers in 0..1, else none. */
export function wirePeaks(peaks: readonly number[] | undefined): number[] | undefined {
  const out = (peaks ?? [])
    .slice(0, MAX_WAVEFORM_PEAKS)
    .map((v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));
  return out.length > 0 ? out : undefined;
}

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

/**
 * BF-2 (VF-848B): the signal of one publish hop. It always times out; a hop bound to a sign-in (every
 * outbox send) also stops on the next sign-in change. Call `done()` when the hop settles.
 */
function hopSignal(ms: number, binding?: AccountBinding): { signal: AbortSignal; done: () => void } {
  const timeout = AbortSignal.timeout(ms);
  if (!binding) return { signal: timeout, done: () => undefined };
  const bound = boundRequestSignal(binding);
  const both = new AbortController();
  const stop = () => both.abort();
  if (bound.signal.aborted) stop();
  timeout.addEventListener('abort', stop);
  bound.signal.addEventListener('abort', stop);
  return {
    signal: both.signal,
    done: () => {
      bound.done();
      timeout.removeEventListener('abort', stop);
      bound.signal.removeEventListener('abort', stop);
    },
  };
}

/** BF-2: a bound hop names its sign-in; the API client sends it only with that sign-in's own credential. */
function hopConfig(signal: AbortSignal, binding?: AccountBinding): BoundRequestConfig | { signal: AbortSignal } {
  return binding ? { signal, accountBinding: binding } : { signal };
}

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
  /** Recorded peaks (omitted when none). */
  waveformPeaks?: number[];
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
   * Bound (BF-2): sent only with that sign-in's credential, and stopped on the next sign-in change.
   */
  async issueUploadUrl(
    workspaceId: string,
    input: IssueVoiceUploadInput,
    binding?: AccountBinding,
  ): Promise<VoiceUploadTarget> {
    const hop = hopSignal(VOICE_REQUEST_TIMEOUT_MS, binding);
    try {
      return await call(VoiceUploadTargetSchema, () =>
        api.post<unknown>(
          `/community/workspaces/${workspaceId}/voice-notes/upload-url`,
          input,
          hopConfig(hop.signal, binding),
        ),
      );
    } finally {
      hop.done();
    }
  },

  /**
   * Direct binary PUT of the recorded audio to the signed upload URL. Returns
   * nothing on success; a transport failure is surfaced as a typed
   * CommunityApiError so the composer can offer a retry without losing the
   * recording. Bound (BF-2): a sign-in change stops it, so no more of the
   * recording goes up after its account signs out.
   */
  async uploadBytes(
    uploadUrl: string,
    body: Blob | ArrayBuffer,
    mimeType: VoiceNoteMimeType,
    onProgress?: (fraction: number) => void,
    binding?: AccountBinding,
  ): Promise<void> {
    const hop = hopSignal(VOICE_UPLOAD_TIMEOUT_MS, binding);
    try {
      // The signed URL is an absolute storage endpoint, not an API route, so
      // we use a bare axios PUT (not the `api` instance with its auth/baseURL).
      await axios.put(uploadUrl, body, {
        headers: { 'Content-Type': mimeType },
        signal: hop.signal,
        ...(onProgress
          ? { onUploadProgress: (e: { loaded: number; total?: number }) => { if (e.total) onProgress(e.loaded / e.total); } }
          : {}),
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
    } finally {
      hop.done();
    }
  },

  /**
   * POST /community/workspaces/:workspaceId/voice-notes
   *
   * Durably records the note after its bytes are uploaded. The server re-asserts
   * the limits and the `${userId}/` bucket binding on `storage_key`.
   * Bound (BF-2): sent only with that sign-in's credential. Not stopped on a
   * sign-in change: once it may have left the phone an abort would not undo
   * it; publishVoiceNote drops an answer that comes after the change.
   */
  create(
    workspaceId: string,
    input: CreateVoiceNoteInput,
    binding?: AccountBinding,
  ): Promise<VoiceNoteView> {
    const body: Record<string, unknown> = {
      storage_key: input.storage_key,
      duration_ms: input.duration_ms,
      bytes: input.bytes,
      mime_type: input.mime_type,
    };
    if (input.cohortId) body.cohort_id = input.cohortId;
    if (input.conversationId) body.conversation_id = input.conversationId;
    const peaks = wirePeaks(input.waveformPeaks);
    if (peaks) body.waveform_peaks = peaks;
    return call(VoiceNoteResponseSchema, () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/voice-notes`,
        body,
        hopConfig(AbortSignal.timeout(VOICE_REQUEST_TIMEOUT_MS), binding),
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
