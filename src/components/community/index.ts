/**
 * Community shared-component barrel (v1-5 client surface). Re-exports the
 * shared components consumed by the 7 Community screens. See each module for
 * the product-plan / voice-policy references it implements.
 */
export { default as CommunityEmptyState } from './EmptyState';
export type { CommunityEmptyStateProps } from './EmptyState';
export { default as UnreadBadge } from './UnreadBadge';
export type { UnreadBadgeProps } from './UnreadBadge';
export { default as RomanAvatar } from './RomanAvatar';
export type { RomanAvatarProps, RomanCrop } from './RomanAvatar';
export { default as SpaceTabBar } from './SpaceTabBar';
export type {
  SpaceTabBarProps,
  SpaceTab,
  CommunitySpaceKey,
} from './SpaceTabBar';
export { default as PostCard } from './PostCard';
export type { PostCardProps } from './PostCard';
export { default as EventCard } from './EventCard';
export type { EventCardProps } from './EventCard';
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
