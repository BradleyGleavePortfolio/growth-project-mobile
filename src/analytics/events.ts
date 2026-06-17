/**
 * events.ts — Typed PostHog event constants for The Growth Project.
 *
 * Taxonomy mirrors the audit-2 taxonomy across five domains:
 *   onboarding, coach, client, growth, retention.
 *
 * Usage:
 *   import { AnalyticsEvents } from '../analytics/events';
 *   track(AnalyticsEvents.WORKOUT_COMPLETED, { session_id: '...' });
 *
 * Rules:
 *   - Snake_case event names, noun-verb order: <subject>_<past-tense-verb>
 *   - All values are string literals so TypeScript narrows the union at call sites.
 *   - No PII in event names — property stripping is handled in posthog.service.ts.
 */

// ─── Onboarding ───────────────────────────────────────────────────────────────

export const AnalyticsEvents = {
  // App lifecycle
  APP_OPENED: 'app_opened',
  APP_BACKGROUNDED: 'app_backgrounded',

  // Onboarding funnel
  ONBOARDING_STARTED: 'onboarding_started',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  ONBOARDING_SKIPPED: 'onboarding_skipped',

  // Auth
  LOGIN_COMPLETED: 'login_completed',
  LOGIN_FAILED: 'login_failed',
  LOGOUT_COMPLETED: 'logout_completed',
  SIGNUP_COMPLETED: 'signup_completed',
  PASSWORD_CHANGED: 'password_changed',

  // Coach
  COACH_SESSION_VIEWED: 'coach_session_viewed',
  COACH_SESSION_BOOKED: 'coach_session_booked',
  COACH_MESSAGE_SENT: 'coach_message_sent',
  COACH_MESSAGE_RECEIVED: 'coach_message_received',
  COACH_BRIEF_VIEWED: 'coach_brief_viewed',
  COACH_ALERT_VIEWED: 'coach_alert_viewed',
  COACH_CLIENT_INVITED: 'coach_client_invited',

  // Client — workouts
  WORKOUT_STARTED: 'workout_started',
  WORKOUT_COMPLETED: 'workout_completed',
  WORKOUT_ABANDONED: 'workout_abandoned',
  EXERCISE_SET_LOGGED: 'exercise_set_logged',
  ROUTINE_CREATED: 'routine_created',
  ROUTINE_EDITED: 'routine_edited',

  // Client — check-ins / logging
  CHECKIN_SUBMITTED: 'checkin_submitted',
  MEAL_LOGGED: 'meal_logged',
  WEIGHT_LOGGED: 'weight_logged',
  WATER_LOGGED: 'water_logged',
  FASTING_STARTED: 'fasting_started',
  FASTING_ENDED: 'fasting_ended',

  // Client — milestones / streaks
  MILESTONE_REACHED: 'milestone_reached',
  STREAK_EXTENDED: 'streak_extended',
  STREAK_BROKEN: 'streak_broken',
  PERSONAL_RECORD_SET: 'personal_record_set',

  // Client — content
  LESSON_VIEWED: 'lesson_viewed',
  RECIPE_VIEWED: 'recipe_viewed',
  RECIPE_SAVED: 'recipe_saved',
  PLAN_VIEWED: 'plan_viewed',

  // Growth — referral / share
  REFERRAL_SHARE_INITIATED: 'referral_share_initiated',
  REFERRAL_SHARE_CARD_SHARED: 'referral_share_card_shared',
  REFERRAL_LINK_COPIED: 'referral_link_copied',
  INVITE_CODE_USED: 'invite_code_used',

  // Retention — settings / prefs
  PREFERENCES_OPENED: 'preferences_opened',
  PREFERENCE_CHANGED: 'preference_changed',
  NOTIFICATION_PREFERENCE_CHANGED: 'notification_preference_changed',
  BIOMETRIC_UNLOCK_ENABLED: 'biometric_unlock_enabled',
  BIOMETRIC_UNLOCK_DISABLED: 'biometric_unlock_disabled',

  // Retention — engagement
  LEADERBOARD_VIEWED: 'leaderboard_viewed',
  COMMUNITY_VIEWED: 'community_viewed',
  TIMELINE_VIEWED: 'timeline_viewed',
  REPORT_VIEWED: 'report_viewed',
  PROGRESS_VIEWED: 'progress_viewed',

  // Coach — workout builder (MWB EW2 undo)
  MWB_UNDO_INVOKED: 'mwb_undo_invoked',
  MWB_UNDO_FAILED: 'mwb_undo_failed',
  MWB_UNDO_STACK_EVICTED: 'mwb_undo_stack_evicted',

  // Coach — custom exercise authoring (EXPO_PUBLIC_FF_CUSTOM_EXERCISE)
  CUSTOM_EXERCISE_CREATED: 'custom_exercise_created',
  CUSTOM_EXERCISE_CREATE_FAILED: 'custom_exercise_create_failed',
} as const;

/** Union of all event name string literals. */
export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

// ─── Property shapes per event ────────────────────────────────────────────────
// Partial type-map: add shapes as needed. Unlisted events accept
// Record<string, unknown> and go through the PII stripper in posthog.service.ts.

export interface AppOpenedProps {
  cold_start: boolean;
}

export interface LoginCompletedProps {
  method: 'email' | 'google' | 'apple';
}

export interface WorkoutCompletedProps {
  session_id: string;
  sets_completed: number;
  exercise_count: number;
  duration_minutes?: number;
}

export interface CheckinSubmittedProps {
  checkin_type: 'weight' | 'meal' | 'custom';
}

export interface ReferralShareCardSharedProps {
  card_type: 'streak' | 'pr' | 'transformation';
  coach_tenant_id?: string;
  destination?: string;
}

export interface MilestoneReachedProps {
  milestone_slug: string;
  milestone_label: string;
  milestone_category: 'consistency' | 'workouts' | 'identity';
}

export interface NotificationPreferenceChangedProps {
  category: 'coach_direct' | 'client_bot' | 'milestones' | 'system';
  enabled: boolean;
}
