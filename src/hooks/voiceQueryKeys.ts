/**
 * voiceQueryKeys — the single source of truth for v3-3 voice-note React Query
 * keys, shared by the feed query (useVoiceFeed) and the publish mutation
 * (useVoiceupload's invalidation). Centralised so the invalidate prefix and the
 * query key can never drift apart.
 *
 * Key shape mirrors the repo convention `['feature', 'sub', …params]`:
 *   feedRoot(ws)        → ['community', 'voice', 'feed', ws]            (invalidate prefix)
 *   feed(ws, scope, n)  → ['community', 'voice', 'feed', ws, scope, n]  (a specific page set)
 *   note(id)            → ['community', 'voice-note', id]               (the voice note page)
 *
 * refreshVoiceQueries re-reads every voice feed, voice note page and voice-bearing Find search on
 * screen (and marks the rest stale): the answer to a removal ping (backend #1165).
 */
import type { QueryClient } from '@tanstack/react-query';
import { VOICE_PAGE_LIMIT } from '../api/communityVoiceApi';
import { communitySearchKeys } from './useCommunitySearch';

export type VoiceFeedScope =
  | { kind: 'all' }
  | { kind: 'cohort'; cohortId: string }
  | { kind: 'conversation'; conversationId: string };

function scopeTag(scope: VoiceFeedScope): string {
  switch (scope.kind) {
    case 'cohort':
      return `cohort:${scope.cohortId}`;
    case 'conversation':
      return `conversation:${scope.conversationId}`;
    case 'all':
    default:
      return 'all';
  }
}

export const voiceKeys = {
  /** Broadest reasonable invalidate prefix for a workspace's voice feed. */
  feedRoot(workspaceId: string): readonly unknown[] {
    return ['community', 'voice', 'feed', workspaceId];
  },
  /** The full key for one scoped, bounded page set. */
  feed(
    workspaceId: string,
    scope: VoiceFeedScope,
    limit: number = VOICE_PAGE_LIMIT,
  ): readonly unknown[] {
    return ['community', 'voice', 'feed', workspaceId, scopeTag(scope), limit];
  },
  /** One voice note page (CommunityVoiceNoteDetail). */
  note(voiceNoteId: string): readonly unknown[] {
    return ['community', 'voice-note', voiceNoteId];
  },
};

/** Every voice query: all feeds (any workspace and scope) and every voice note page. */
function isVoiceKey(key: readonly unknown[]): boolean {
  return key[0] === 'community' && (key[1] === 'voice' || key[1] === 'voice-note');
}

/**
 * A Find search whose pages can hold a voice transcript excerpt: all kinds ('∅') or voice only.
 * Same test as purgeSavedVoiceSearches; post, lesson and event searches never match (LS-881R6 B1).
 */
function isVoiceSearchKey(key: readonly unknown[]): boolean {
  const root = communitySearchKeys.all;
  if (key[0] !== root[0] || key[1] !== root[1]) return false;
  const kind = key[root.length + 2];
  return kind === '∅' || kind === 'voice_note_transcript';
}

/**
 * Re-read the voice queries on screen over REST, open Find searches included, so the server's answer
 * drops a removed note's excerpt; the others are only marked stale. A closed Find search is dropped
 * so reopening it cannot show the removed words before the new answer lands.
 */
export function refreshVoiceQueries(qc: QueryClient): Promise<void> {
  qc.removeQueries({ type: 'inactive', predicate: (q) => isVoiceSearchKey(q.queryKey) });
  return qc.invalidateQueries({
    predicate: (q) => isVoiceKey(q.queryKey) || isVoiceSearchKey(q.queryKey),
  });
}
