/**
 * coachExerciseApi — typed client for the coach-owned custom exercise library
 * (the persistence spine behind EXPO_PUBLIC_FF_CUSTOM_EXERCISE).
 *
 * Backend contract source of truth (do not drift — lands in the stacked
 * backend PR gated by FEATURE_CUSTOM_EXERCISE):
 *   growth-project-backend/src/coach-exercise/coach-exercise.controller.ts
 *   growth-project-backend/src/coach-exercise/coach-exercise.dto.ts
 *
 * Why this exists: today a coach can only SELECT a move from the read-only
 * ExerciseDB catalog — there is no way to AUTHOR a brand-new move (a yoga
 * stretch TGP has no catalog entry for) with their own name, written
 * instructions, and their own image/video. This client lets the coach create
 * such a move and KEEP it in a reusable, coach-owned library.
 *
 * Wire posture (mirrors communityVoiceApi.ts exactly — the one shipped
 * coach-usable media-upload idiom):
 *   - Media publish is a three-hop, server-authoritative pipeline:
 *       1. issueMediaUploadUrl(...) validates kind/size/mime and mints a signed
 *          PUT target + the opaque `storage_key` (namespaced to the caller).
 *       2. the client PUTs the raw bytes directly to `upload_url` (bare axios,
 *          NOT the `api` instance — the signed URL is an absolute storage
 *          endpoint, not an API route).
 *       3. create(...) durably records the exercise, re-asserting the limits and
 *          the `${userId}/` bucket binding. The client is never trusted on the
 *          bytes hop — the server re-derives the namespace.
 *   - Every JSON response is Zod-validated at the boundary so a drifted shape
 *     THROWS here (wrapped `contract`) instead of feeding malformed data into
 *     React state.
 *   - The read `media_url` is a time-limited signed GET minted server-side; it
 *     is nullable so an exercise whose storage is unconfigured degrades to a
 *     caption + instructions rather than a broken image/player.
 *   - A media attachment is OPTIONAL: a coach may author a move with name +
 *     instructions and no media (media_kind === 'none').
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { CommunityApiError } from './communityApi';

// ─── Server limits (mirror backend coach-exercise.dto.ts) ────────────────────

/** Max name length for a custom move. */
export const MAX_CUSTOM_EXERCISE_NAME = 120;
/** Max written-instructions length. */
export const MAX_CUSTOM_EXERCISE_INSTRUCTIONS = 2000;
/** Max media payload — 50 MB (a short demo clip or a high-res image). */
export const MAX_CUSTOM_EXERCISE_MEDIA_BYTES = 50_000_000;

/** The media kinds a coach may attach. `none` is a move with no media. */
export const CUSTOM_EXERCISE_MEDIA_KINDS = ['image', 'video', 'none'] as const;
export type CustomExerciseMediaKind =
  (typeof CUSTOM_EXERCISE_MEDIA_KINDS)[number];

/**
 * The allowed upload MIME types (mirror backend allowlist). A type outside this
 * set is rejected client-side before any signed URL is requested, and again
 * server-side.
 */
export const CUSTOM_EXERCISE_MIME_ALLOWLIST = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const;
export type CustomExerciseMime =
  (typeof CUSTOM_EXERCISE_MIME_ALLOWLIST)[number];

/** Defensive page size for the library list read (bounded). */
export const COACH_EXERCISE_PAGE_LIMIT = 50;

// ─── Response schemas (mirror backend Zod, snake_case wire shape) ────────────

export const CoachExerciseMediaTargetSchema = z
  .object({
    upload_url: z.string(),
    storage_key: z.string(),
    expires_at: z.string(),
    expires_in_seconds: z.number().int(),
    bucket: z.string(),
  })
  .strict();
export type CoachExerciseMediaTarget = z.infer<
  typeof CoachExerciseMediaTargetSchema
>;

export const CoachExerciseSchema = z
  .object({
    id: z.string(),
    coach_id: z.string(),
    name: z.string(),
    instructions: z.string(),
    media_kind: z.enum(CUSTOM_EXERCISE_MEDIA_KINDS),
    /**
     * Time-limited signed GET URL for the attached image/video, or null when
     * media_kind is 'none' or signing is unavailable. The UI renders a caption
     * + instructions rather than a broken control when null.
     */
    media_url: z.string().nullable(),
    media_mime: z.string().nullable(),
    created_at: z.string(),
    archived_at: z.string().nullable(),
  })
  .strict();
export type CoachExercise = z.infer<typeof CoachExerciseSchema>;

const CoachExerciseResponseSchema = z
  .object({ coach_exercise: CoachExerciseSchema })
  .strict();

const CoachExerciseListResponseSchema = z
  .object({ coach_exercises: z.array(CoachExerciseSchema) })
  .strict();
export type CoachExerciseListPage = z.infer<
  typeof CoachExerciseListResponseSchema
>;

// ─── Transport helper (mirrors communityVoiceApi.call) ───────────────────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/** External-fetch timeout (every JSON call carries an AbortSignal.timeout). */
export const COACH_EXERCISE_REQUEST_TIMEOUT_MS = 15_000;
/** The raw byte upload can be larger/slower than a JSON call. */
export const COACH_EXERCISE_UPLOAD_TIMEOUT_MS = 120_000;

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
        `coach-exercise request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'coach-exercise request failed',
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
        'coach-exercise response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

// ─── Request payloads (mirror backend DTOs) ──────────────────────────────────

export interface IssueCoachExerciseMediaInput {
  bytes: number;
  mime_type: CustomExerciseMime;
}

export interface CreateCoachExerciseInput {
  name: string;
  instructions: string;
  media_kind: CustomExerciseMediaKind;
  /** Present only when media_kind is 'image' | 'video'. */
  storage_key?: string;
  media_mime?: CustomExerciseMime;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const coachExerciseApi = {
  /**
   * POST /coach-exercises/media/upload-url
   *
   * Validates size/mime and mints a signed PUT target plus the opaque
   * `storage_key` (namespaced to the calling coach). No row is created yet.
   */
  issueMediaUploadUrl(
    input: IssueCoachExerciseMediaInput,
  ): Promise<CoachExerciseMediaTarget> {
    return call(CoachExerciseMediaTargetSchema, () =>
      api.post<unknown>('/coach-exercises/media/upload-url', input, {
        signal: AbortSignal.timeout(COACH_EXERCISE_REQUEST_TIMEOUT_MS),
      }),
    );
  },

  /**
   * Direct binary PUT of the picked image/video to the signed upload URL.
   * Returns nothing on success; a transport failure is surfaced as a typed
   * CommunityApiError so the composer can offer a retry without re-picking.
   */
  async uploadBytes(
    uploadUrl: string,
    body: Blob | ArrayBuffer,
    mimeType: CustomExerciseMime,
  ): Promise<void> {
    try {
      // The signed URL is an absolute storage endpoint, not an API route, so
      // we use a bare axios PUT (not the `api` instance with its auth/baseURL).
      await axios.put(uploadUrl, body, {
        headers: { 'Content-Type': mimeType },
        signal: AbortSignal.timeout(COACH_EXERCISE_UPLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? 0;
        throw new CommunityApiError(
          classify(status),
          status,
          `coach-exercise media upload failed (${status || 'network'})`,
          err,
        );
      }
      throw new CommunityApiError(
        'unknown',
        -1,
        'coach-exercise media upload failed',
        err,
      );
    }
  },

  /**
   * POST /coach-exercises
   *
   * Durably records the authored move after any media bytes are uploaded. The
   * server re-asserts the limits and the `${userId}/` bucket binding on
   * `storage_key` when media is attached.
   */
  create(input: CreateCoachExerciseInput): Promise<CoachExercise> {
    const body: Record<string, unknown> = {
      name: input.name,
      instructions: input.instructions,
      media_kind: input.media_kind,
    };
    if (input.storage_key) body.storage_key = input.storage_key;
    if (input.media_mime) body.media_mime = input.media_mime;
    return call(CoachExerciseResponseSchema, () =>
      api.post<unknown>('/coach-exercises', body, {
        signal: AbortSignal.timeout(COACH_EXERCISE_REQUEST_TIMEOUT_MS),
      }),
    ).then((r) => r.coach_exercise);
  },

  /**
   * GET /coach-exercises
   *
   * The coach's own reusable library, newest first. RLS scopes the rows to the
   * calling coach; the client renders what it gets.
   */
  list(): Promise<CoachExerciseListPage> {
    return call(CoachExerciseListResponseSchema, () =>
      api.get<unknown>('/coach-exercises', {
        params: { limit: COACH_EXERCISE_PAGE_LIMIT },
        signal: AbortSignal.timeout(COACH_EXERCISE_REQUEST_TIMEOUT_MS),
      }),
    );
  },
};

export type CoachExerciseApi = typeof coachExerciseApi;
