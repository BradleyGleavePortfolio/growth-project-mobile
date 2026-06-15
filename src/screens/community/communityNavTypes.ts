/**
 * communityNavTypes — typed param list + shared nav props for the Community
 * sub-stack (v1-5). The stack is mounted by ClientNavigator ONLY when
 * `featureFlags.communityTab` is true (see ClientNavigator.tsx). The deep-link
 * route is likewise registered only behind that flag.
 */
import type {
  NavigationProp,
  RouteProp,
  ParamListBase,
} from '@react-navigation/native';

export type CommunityStackParamList = {
  /** Container with the Space sub-tab switcher (Today / Hall / Cohorts / DMs). */
  CommunityTab: undefined;
  /** The "today" object — universal home for what's happening for the client. */
  CommunityToday: undefined;
  /** A Space view: Hall (workspace) or a specific Cohort. */
  CommunitySpace: { space: 'hall' | 'cohort'; cohortId?: string };
  /** Single thread / post detail. */
  CommunityThread: { postId: string };
  /** Single community event detail (v2-3). */
  CommunityEventDetail: { eventId: string };
  /** DM inbox. */
  CommunityDmList: undefined;
  /** Single DM conversation. */
  CommunityDmThread: { recipientId: string; participantLabel?: string };
  /** Compose a post (or, with a recipient, a DM). */
  CommunityComposer:
    | { mode: 'post' }
    | { mode: 'dm'; recipientId: string }
    | undefined;
  /** Single challenge detail (v3-1). Registered only behind communityChallenges. */
  CommunityChallengeDetail: { challengeId: string };
  /** Challenge discovery list (v3-1). Registered only behind communityChallenges. */
  CommunityChallenges: undefined;
  /** Classroom lesson feed (v3-2). Registered only behind communityClassroom. */
  CommunityClassroom: undefined;
  /** Single classroom lesson detail (v3-2). Registered only behind communityClassroom. */
  CommunityLessonDetail: { postId: string };
  /**
   * Record + send a voice note (v3-3). Registered only behind
   * `communityVoiceNotes`. The target picks the audience the recording is
   * published to (and is disclosed before send):
   *   - { target: 'hall' }                       → the whole community
   *   - { target: 'cohort'; cohortId; cohortName? } → a named cohort
   *   - { target: 'dm'; conversationId; recipientId?; recipientName? } → a DM
   */
  CommunityVoiceComposer:
    | { target: 'hall' }
    | { target: 'cohort'; cohortId: string; cohortName?: string }
    | {
        target: 'dm';
        conversationId: string;
        recipientId?: string;
        recipientName?: string;
      };
};

/** Loosely-typed nav prop used by the screens (matches the codebase pattern). */
export type CommunityNav = NavigationProp<ParamListBase>;
export type CommunityRoute<T extends keyof CommunityStackParamList> = RouteProp<
  Record<string, CommunityStackParamList[T]>,
  string
>;
