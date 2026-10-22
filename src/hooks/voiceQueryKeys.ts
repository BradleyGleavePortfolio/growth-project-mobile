/**
 * voiceQueryKeys — the single source of truth for v3-3 voice-note React Query
 * keys, shared by the feed query (useVoiceFeed) and the publish mutation
 * (useVoiceupload's invalidation). Centralised so the invalidate prefix and the
 * query key can never drift apart.
 *
 * Key shape mirrors the repo convention `['feature', 'sub', …params]`:
 *   feedRoot(ws)        → ['community', 'voice', 'feed', ws]            (invalidate prefix)
 *   feed(ws, scope, n)  → ['community', 'voice', 'feed', ws, scope, n]  (a specific page set)
 */
import { VOICE_PAGE_LIMIT } from '../api/communityVoiceApi';

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
};
