/**
 * Community shared-component barrel (v1-5 client surface). Re-exports the
 * shared components consumed by the 7 Community screens. See each module for
 * the product-plan / voice-policy references it implements.
 */
export { default as CommunityEmptyState } from './EmptyState';
export type { CommunityEmptyStateProps } from './EmptyState';
export { default as UnreadBadge } from './UnreadBadge';
export type { UnreadBadgeProps } from './UnreadBadge';
// RomanAvatar is the canonical Roman brand-character avatar; it now lives in
// the roman/ lane (D-013, Path A). Community surfaces still consume it through
// this barrel, so the re-export is preserved but points at the roman/ source.
export { default as RomanAvatar } from '../roman/RomanAvatar';
export type { RomanAvatarProps, RomanCrop } from '../roman/RomanAvatar';
export { default as SpaceTabBar } from './SpaceTabBar';
export type {
  SpaceTabBarProps,
  SpaceTab,
  CommunitySpaceKey,
} from './SpaceTabBar';
export { default as PostCard } from './PostCard';
export type { PostCardProps } from './PostCard';
export { default as EventCard, stateMeta, formatEventStart, rsvpSummary } from './EventCard';
export type { EventCardProps, EventStateMeta } from './EventCard';
export { default as ThreadHeader } from './ThreadHeader';
export type { ThreadHeaderProps } from './ThreadHeader';
export { default as ReactionBar } from './ReactionBar';
export type { ReactionBarProps } from './ReactionBar';
export { default as DmRow } from './DmRow';
export type { DmRowProps } from './DmRow';
export { default as MessageBubble } from './MessageBubble';
export type { MessageBubbleProps } from './MessageBubble';
export { default as ComposerInput } from './ComposerInput';
export type { ComposerInputProps } from './ComposerInput';
export { default as TimelineMarker } from './TimelineMarker';
export type { TimelineMarkerProps } from './TimelineMarker';
export { default as AckSignalChip } from './AckSignalChip';
export type { AckSignalChipProps, AckSignal } from './AckSignalChip';
export {
  romanCopy,
  shouldUseDryQuip,
  ROMAN_COMMUNITY_LINES,
  ROMAN_QUIP_RATE_CLIENT,
} from './romanVoice';
export type { RomanCommunityStem, RomanLine } from './romanVoice';
// ─── Community v3-1 challenges (flag-gated host vocabulary) ───────────────
export { default as ChallengeCard } from './ChallengeCard';
export type { ChallengeCardProps } from './ChallengeCard';
export { default as ChallengeCommentsEmptyState } from './ChallengeCommentsEmptyState';
export type { ChallengeCommentsEmptyStateProps } from './ChallengeCommentsEmptyState';
// ─── Community v3-2 classroom posts (flag-gated read-only student surface) ─
export { default as LessonCard, primaryMediaKind, mediaSummary } from './LessonCard';
export type { LessonCardProps } from './LessonCard';
export { default as LessonReleaseLockBadge, relativeUnlockHint } from './LessonReleaseLockBadge';
export type { LessonReleaseLockBadgeProps } from './LessonReleaseLockBadge';
export { default as ClassroomEmptyState } from './ClassroomEmptyState';
export type { ClassroomEmptyStateProps } from './ClassroomEmptyState';
