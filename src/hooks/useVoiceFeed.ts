/**
 * useVoiceFeed — the read-only, cursor-paginated query for the v3-3 community
 * voice-note feed. Mirrors useClassroomFeed exactly (the v3-2 read pattern):
 * a bounded `useInfiniteQuery` so older notes stay reachable without an
 * unbounded fetch.
 *
 * Posture:
 *   - ENABLED only when a non-null workspace id exists AND the
 *     `communityVoiceNotes` flag is on. With the flag off the composer/feed
 *     routes are not registered, so this is belt-and-suspenders: no voice
 *     request is ever issued in a flag-off build.
 *   - The page limit + scope are part of the key (via voiceKeys.feed) so a
 *     different scope is a distinct cache entry; the cursor threads through
 *     pageParam under that key.
 *   - Pure read: nothing is mutated here.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  UseInfiniteQueryResult,
  InfiniteData,
} from '@tanstack/react-query';
import { featureFlags } from '../config/featureFlags';
import {
  communityVoiceApi,
  VOICE_PAGE_LIMIT,
  type VoiceNoteFeedPage,
} from '../api/communityVoiceApi';
import { voiceKeys, type VoiceFeedScope } from './voiceQueryKeys';

export interface UseVoiceFeedOptions {
  /** Workspace id — voice notes are workspace-scoped. Null → query disabled. */
  workspaceId: string | null;
  /** Optional cohort scope. */
  cohortId?: string;
  /** Optional DM conversation scope. */
  conversationId?: string;
}

export type VoiceFeedQuery = UseInfiniteQueryResult<
  InfiniteData<VoiceNoteFeedPage>,
  Error
>;

function toScope(opts: UseVoiceFeedOptions): VoiceFeedScope {
  if (opts.conversationId) {
    return { kind: 'conversation', conversationId: opts.conversationId };
  }
  if (opts.cohortId) return { kind: 'cohort', cohortId: opts.cohortId };
  return { kind: 'all' };
}

export function useVoiceFeed(options: UseVoiceFeedOptions): VoiceFeedQuery {
  const { workspaceId, cohortId, conversationId } = options;
  return useInfiniteQuery({
    queryKey: voiceKeys.feed(workspaceId ?? '∅', toScope(options)),
    queryFn: ({ pageParam }) => {
      // Unreachable at runtime: enabled only when workspaceId is non-null. The
      // guard narrows `string | null` -> `string` without a cast.
      if (!workspaceId) throw new Error('workspaceId is required');
      return communityVoiceApi.listFeed(workspaceId, {
        limit: VOICE_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(cohortId ? { cohortId } : {}),
        ...(conversationId ? { conversationId } : {}),
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!workspaceId && featureFlags.communityVoiceNotes,
  });
}
