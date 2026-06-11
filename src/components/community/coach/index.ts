/**
 * Coach-only community shared-component barrel (v1-6 surface). Re-exports the
 * components and helpers consumed by the six CoachCommunity screens. These are
 * coach-only and live under `community/coach/` so they never leak into the
 * client community surface.
 */
export { default as CoachEmptyState } from './CoachEmptyState';
export type { CoachEmptyStateProps } from './CoachEmptyState';
export { default as MonogramBadge } from './MonogramBadge';
export type { MonogramBadgeProps } from './MonogramBadge';
export { default as ConfirmModal } from './ConfirmModal';
export type { ConfirmModalProps } from './ConfirmModal';
export { relativeAge } from './relativeAge';
export { COACH_EMPTY_COPY } from './coachVoice';
export type { CoachVoiceEntry, CoachEmptyKey } from './coachVoice';
