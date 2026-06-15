/**
 * coachCommunityNavTypes — typed param list + shared nav props for the v1-6
 * Coach Community sub-stack. The stack is mounted by CoachNavigator ONLY when
 * `featureFlags.coachCommunity` is true (see CoachNavigator.tsx). When the flag
 * is OFF none of these routes register, so none are reachable by deep link.
 */
import type {
  NavigationProp,
  RouteProp,
  ParamListBase,
} from '@react-navigation/native';

export type CoachCommunityStackParamList = {
  /** Top-level coach landing: unread inbox, active cohorts, flagged today. */
  CoachCommunityHome: undefined;
  /** Aggregated unanswered items across the coach's cohorts. */
  CoachCommunityInbox: undefined;
  /** List of the coach's cohorts with a create-cohort FAB. */
  CoachCommunityCohorts: undefined;
  /** Cohort header + member list + invite / remove flows. */
  CoachCommunityCohortDetail: { cohortId: string; cohortName?: string };
  /** A single post: title, body, author, timestamp, reply thread. */
  CoachCommunityPostDetail: { postId: string; flagged?: boolean };
  /** Flagged-content moderation queue (hide, confirmed). */
  CoachCommunityModeration: undefined;
  /** Coach event list + lifecycle management (v2-3). */
  CoachCommunityEvents: undefined;
  /**
   * COACH-ONLY wearable coaching prompts for a single client (v3-4).
   * Registered only behind `featureFlags.communityWearablePrompts`.
   */
  CoachCommunityWearablePrompts: { clientId: string; clientName?: string };
};

/** Loosely-typed nav prop used by the screens (matches the codebase pattern). */
export type CoachCommunityNav = NavigationProp<ParamListBase>;
export type CoachCommunityRoute<T extends keyof CoachCommunityStackParamList> =
  RouteProp<Record<string, CoachCommunityStackParamList[T]>, string>;
