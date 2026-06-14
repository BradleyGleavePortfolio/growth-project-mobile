/**
 * useVoiceUpload — orchestrates the v3-3 two-hop publish pipeline for a finished
 * recording, and invalidates the voice-note feed on success.
 *
 * Flow (server-authoritative at every hop):
 *   1. issueUploadUrl(workspaceId, { duration_ms, bytes, mime_type })
 *        → the server validates limits + mints a signed PUT target + storage_key
 *   2. uploadBytes(upload_url, <audio bytes>, mime_type)
 *        → the client PUTs the raw audio directly to storage
 *   3. create(workspaceId, { storage_key, duration_ms, bytes, mime_type, … })
 *        → the server re-asserts limits + the `${userId}/` bucket binding and
 *          durably records the note
 *
 * Posture:
 *   - Pre-flight client validation mirrors the server limits (duration in
 *     [1, 300000] ms, bytes in [1, 25_000_000], mime in the allowlist) so an
 *     obviously-invalid recording fails fast WITHOUT a round-trip; the server
 *     remains authoritative.
 *   - The mutation reads the recording's bytes lazily via an injectable
 *     `readBytes` reader (defaults to a fetch(uri) → arrayBuffer), so tests
 *     never touch the filesystem and a host can swap in expo-file-system.
 *   - A failure preserves the recording (the mutation input is unchanged), so
 *     the composer can offer "Retry" without re-recording. Errors surface as
 *     the typed CommunityApiError the API client throws.
 *   - On success the workspace voice-note feed query is invalidated so the new
 *     note appears without a manual refetch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  communityVoiceApi,
  MAX_VOICE_DURATION_MS,
  MIN_VOICE_DURATION_MS,
  MAX_VOICE_BYTES,
  VOICE_NOTE_MIME_ALLOWLIST,
  type VoiceNoteMimeType,
  type VoiceNoteView,
} from '../api/communityVoiceApi';
import { voiceKeys } from './voiceQueryKeys';

/** A recording handed to the upload pipeline. */
export interface VoiceUploadInput {
  uri: string;
  durationMs: number;
  bytes: number;
  mimeType: VoiceNoteMimeType;
  /** Optional cohort target; omitted (with no conversation) → workspace hall. */
  cohortId?: string;
  /** Optional DM conversation target. */
  conversationId?: string;
}

export interface UseVoiceUploadOptions {
  /** Inject a byte reader for tests; defaults to fetch(uri) → arrayBuffer. */
  readBytes?: (uri: string) => Promise<ArrayBuffer>;
}

export type VoiceUploadMutation = UseMutationResult<
  VoiceNoteView,
  Error,
  VoiceUploadInput
>;

/** Pre-flight validation mirroring the server limits; throws on violation. */
export function assertVoicePublishable(input: VoiceUploadInput): void {
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs < MIN_VOICE_DURATION_MS ||
    input.durationMs > MAX_VOICE_DURATION_MS
  ) {
    throw new RangeError('voice note duration is out of range');
  }
  if (
    !Number.isInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > MAX_VOICE_BYTES
  ) {
    throw new RangeError('voice note size is out of range');
  }
  if (!VOICE_NOTE_MIME_ALLOWLIST.includes(input.mimeType)) {
    throw new RangeError('voice note mime type is not allowed');
  }
}

async function defaultReadBytes(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  return res.arrayBuffer();
}

export function useVoiceUpload(
  workspaceId: string | null,
  options: UseVoiceUploadOptions = {},
): VoiceUploadMutation {
  const qc = useQueryClient();
  const readBytes = options.readBytes ?? defaultReadBytes;

  return useMutation<VoiceNoteView, Error, VoiceUploadInput>({
    mutationFn: async (input) => {
      if (!workspaceId) {
        throw new Error('workspaceId is required to publish a voice note');
      }
      assertVoicePublishable(input);

      // Hop 1 — mint the signed upload target (server validates limits).
      const target = await communityVoiceApi.issueUploadUrl(workspaceId, {
        duration_ms: input.durationMs,
        bytes: input.bytes,
        mime_type: input.mimeType,
      });

      // Hop 2 — PUT the raw audio bytes to storage.
      const body = await readBytes(input.uri);
      await communityVoiceApi.uploadBytes(
        target.upload_url,
        body,
        input.mimeType,
      );

      // Hop 3 — durably record the note (server re-asserts the bucket binding).
      return communityVoiceApi.create(workspaceId, {
        storage_key: target.storage_key,
        duration_ms: input.durationMs,
        bytes: input.bytes,
        mime_type: input.mimeType,
        ...(input.cohortId ? { cohortId: input.cohortId } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      });
    },
    onSuccess: () => {
      if (workspaceId) {
        void qc.invalidateQueries({
          queryKey: voiceKeys.feedRoot(workspaceId),
        });
      }
    },
  });
}
