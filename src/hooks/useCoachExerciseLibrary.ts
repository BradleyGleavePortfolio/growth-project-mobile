/**
 * useCoachExerciseLibrary — reads the coach's own reusable custom-move library
 * and publishes a newly authored move (with optional image/video) into it.
 *
 * Behind EXPO_PUBLIC_FF_CUSTOM_EXERCISE. The publish mutation reuses the same
 * three-hop, server-authoritative media idiom the community voice-note pipeline
 * ships (presign -> direct PUT -> durable create), so a coach's image/video is
 * KEPT and the authored move is reusable across plans and clients.
 *
 * Posture:
 *   - Pre-flight client validation mirrors the server limits (name +
 *     instructions length, media size + mime allowlist) so an obviously-invalid
 *     draft fails fast WITHOUT a round-trip; the server remains authoritative.
 *   - The media bytes are read lazily via an injectable `readBytes` reader
 *     (defaults to fetch(uri) -> arrayBuffer) so tests never touch the
 *     filesystem and a host can swap in expo-file-system.
 *   - A media-less move (mediaKind 'none') skips both upload hops and posts
 *     name + instructions directly.
 *   - A failure preserves the draft (the mutation input is unchanged) so the
 *     composer can offer "Retry" without re-entering anything. Errors surface as
 *     the typed CommunityApiError the API client throws.
 *   - On success the library list query is invalidated so the new move appears
 *     without a manual refetch.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  UseMutationResult,
  UseQueryResult,
} from '@tanstack/react-query';
import {
  coachExerciseApi,
  CUSTOM_EXERCISE_MIME_ALLOWLIST,
  MAX_CUSTOM_EXERCISE_INSTRUCTIONS,
  MAX_CUSTOM_EXERCISE_MEDIA_BYTES,
  MAX_CUSTOM_EXERCISE_NAME,
  type CoachExercise,
  type CustomExerciseMediaKind,
  type CustomExerciseMime,
} from '../api/coachExerciseApi';
import { featureFlags } from '../config/featureFlags';

/** The single source of truth for the library React Query key. */
export const coachExerciseKeys = {
  /** Invalidate prefix + the list key (the library is a single bounded read). */
  list(): readonly unknown[] {
    return ['coach-exercise', 'library'];
  },
};

/** A move handed to the publish pipeline. */
export interface AuthorExerciseInput {
  name: string;
  instructions: string;
  mediaKind: CustomExerciseMediaKind;
  /** Present only when mediaKind is 'image' | 'video'. */
  media?: {
    uri: string;
    bytes: number;
    mimeType: CustomExerciseMime;
  };
}

export interface UseAuthorExerciseOptions {
  /** Inject a byte reader for tests; defaults to fetch(uri) -> arrayBuffer. */
  readBytes?: (uri: string) => Promise<ArrayBuffer>;
}

export type AuthorExerciseMutation = UseMutationResult<
  CoachExercise,
  Error,
  AuthorExerciseInput
>;

/** Pre-flight validation mirroring the server limits; throws on violation. */
export function assertAuthorable(input: AuthorExerciseInput): void {
  const name = input.name.trim();
  if (name.length < 1 || name.length > MAX_CUSTOM_EXERCISE_NAME) {
    throw new RangeError('custom exercise name is out of range');
  }
  if (input.instructions.length > MAX_CUSTOM_EXERCISE_INSTRUCTIONS) {
    throw new RangeError('custom exercise instructions are too long');
  }
  if (input.mediaKind === 'none') {
    if (input.media) {
      throw new RangeError('media must be omitted when no media is attached');
    }
    return;
  }
  if (!input.media) {
    throw new RangeError('media is required when a media kind is set');
  }
  if (
    !Number.isInteger(input.media.bytes) ||
    input.media.bytes < 1 ||
    input.media.bytes > MAX_CUSTOM_EXERCISE_MEDIA_BYTES
  ) {
    throw new RangeError('custom exercise media size is out of range');
  }
  if (!CUSTOM_EXERCISE_MIME_ALLOWLIST.includes(input.media.mimeType)) {
    throw new RangeError('custom exercise media mime type is not allowed');
  }
}

async function defaultReadBytes(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  return res.arrayBuffer();
}

/**
 * Reads the coach's own library. The query is disabled when the flag is OFF so
 * a flag-off build does ZERO network work.
 */
export function useCoachExerciseLibrary(): UseQueryResult<
  CoachExercise[],
  Error
> {
  return useQuery<CoachExercise[], Error>({
    queryKey: coachExerciseKeys.list(),
    queryFn: () => coachExerciseApi.list().then((p) => p.coach_exercises),
    enabled: featureFlags.customExercise,
    staleTime: 60_000,
  });
}

/** Publishes a newly authored move (with optional media) into the library. */
export function useAuthorExercise(
  options: UseAuthorExerciseOptions = {},
): AuthorExerciseMutation {
  const qc = useQueryClient();
  const readBytes = options.readBytes ?? defaultReadBytes;

  return useMutation<CoachExercise, Error, AuthorExerciseInput>({
    mutationFn: async (input) => {
      assertAuthorable(input);
      const name = input.name.trim();
      const instructions = input.instructions.trim();

      if (input.mediaKind === 'none' || !input.media) {
        return coachExerciseApi.create({
          name,
          instructions,
          media_kind: 'none',
        });
      }

      // Hop 1 — mint the signed upload target (server validates limits).
      const target = await coachExerciseApi.issueMediaUploadUrl({
        bytes: input.media.bytes,
        mime_type: input.media.mimeType,
      });

      // Hop 2 — PUT the raw media bytes to storage.
      const body = await readBytes(input.media.uri);
      await coachExerciseApi.uploadBytes(
        target.upload_url,
        body,
        input.media.mimeType,
      );

      // Hop 3 — durably record the move (server re-asserts the bucket binding).
      return coachExerciseApi.create({
        name,
        instructions,
        media_kind: input.mediaKind,
        storage_key: target.storage_key,
        media_mime: input.media.mimeType,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: coachExerciseKeys.list() });
    },
  });
}
