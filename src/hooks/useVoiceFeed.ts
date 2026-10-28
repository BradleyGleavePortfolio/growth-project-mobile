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
 *   - Catch-up (backend #1165, a coach's removal): a removal ping re-reads the feed live
 *     (useCommunityBadge). A ping missed while the phone slept or the socket was down heals when the
 *     app returns to the foreground or the screen regains focus (useVoiceCatchUp), bounded below.
 */
import { createContext, useContext, useEffect, useRef, type ContextType } from 'react';
import { AppState } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
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

/**
 * The catch-up bound: at most one re-read per voice screen per 15 s, counted from its last read (a
 * ping's re-read counts). A return to the app or to the screen comes in bursts (an iOS banner or Face
 * ID flips the app inactive and back, Back from a note page refocuses the list), and 15 s folds each
 * burst into one GET while staying under the 30 s staleTime, so a note removed while the phone slept is
 * gone on the first look back. Live removals ride the ping, not this.
 */
export const VOICE_CATCH_UP_MS = 15_000;

/** Stands in when the navigation module is stubbed (tests): no focus, the foreground return still applies. */
const NoNavigation = createContext<ContextType<typeof NavigationContext>>(undefined);

/**
 * Re-reads a voice query when the app returns to the foreground or its screen regains focus, at most
 * once per VOICE_CATCH_UP_MS. No read before the first answer (that read is already running) and none
 * while disabled. Outside a navigator only the foreground return applies.
 */
export function useVoiceCatchUp(
  query: { refetch: (o?: { cancelRefetch?: boolean }) => unknown; dataUpdatedAt: number },
  enabled: boolean,
): void {
  const navigation = useContext(NavigationContext ?? NoNavigation);
  const latest = useRef({ query, enabled, last: 0 });
  latest.current.query = query;
  latest.current.enabled = enabled;
  useEffect(() => {
    const catchUp = () => {
      const s = latest.current;
      const now = Date.now();
      const lastRead = Math.max(s.last, s.query.dataUpdatedAt);
      if (!s.enabled || !s.query.dataUpdatedAt || now - lastRead < VOICE_CATCH_UP_MS) return;
      s.last = now;
      void s.query.refetch({ cancelRefetch: false });
    };
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });
    const offFocus =
      typeof navigation?.addListener === 'function' ? navigation.addListener('focus', catchUp) : undefined;
    return () => {
      app.remove();
      offFocus?.();
    };
  }, [navigation]);
}

export function useVoiceFeed(options: UseVoiceFeedOptions): VoiceFeedQuery {
  const { workspaceId, cohortId, conversationId } = options;
  const enabled = !!workspaceId && featureFlags.communityVoiceNotes;
  const feed = useInfiniteQuery({
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
    enabled,
    meta: { persist: false }, // never a list saved to the phone, so a restart cannot show notes from before a ban
  });
  useVoiceCatchUp(feed, enabled);
  return feed;
}
