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
  /** Private scratch space for drafting posts/DMs (AsyncStorage only). */
  CoachCommunityLab: undefined;
  /** List of the coach's cohorts with a create-cohort FAB. */
  CoachCommunityCohorts: undefined;
  /** Cohort header + member list + invite / remove flows. */
  CoachCommunityCohortDetail: { cohortId: string; cohortName?: string };
  /** Flagged-content moderation queue (hide / approve, confirmed). */
  CoachCommunityModeration: undefined;
};

/** Loosely-typed nav prop used by the screens (matches the codebase pattern). */
export type CoachCommunityNav = NavigationProp<ParamListBase>;
export type CoachCommunityRoute<T extends keyof CoachCommunityStackParamList> =
  RouteProp<Record<string, CoachCommunityStackParamList[T]>, string>;
