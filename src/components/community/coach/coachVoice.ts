/**
 * coachVoice — operator-locked Roman copy strings for the v1-6 coach community
 * empty states (locked 2026-06-10). Centralised so the screens and their tests
 * import a single source of truth; a drift between a screen and its test is
 * impossible because both read these constants.
 *
 * Copy rules (ROMAN_VOICE_POLICY §4): no exclamation points, no emoji, no
 * "Oops/Whoops/Uh oh", one next step per message, optional `— Roman` sign-off
 * on multi-line copy, never `— The TGP Team`.
 *
 * Each entry also records the approved avatar crop so the screen cannot pair
 * the wrong face with the copy.
 */
import type { RomanCrop } from '../RomanAvatar';

export interface CoachVoiceEntry {
  /** Approved avatar crop for this surface. */
  crop: Extract<RomanCrop, 'neutral' | 'smile'>;
  /** The locked copy string. */
  copy: string;
}

export const COACH_EMPTY_COPY = {
  /** CoachCommunityHomeScreen — quiet landing. */
  home: {
    crop: 'neutral',
    copy: 'Quiet morning. When your cohorts need you, I will bring it here. — Roman',
  },
  /** CoachCommunityInboxScreen — nothing unanswered. */
  inbox: {
    crop: 'neutral',
    copy: 'The inbox is clear. When something needs you, it will be here.',
  },
  /** CoachCommunityLabScreen — blank drafting surface. */
  lab: {
    crop: 'neutral',
    copy: 'A blank page is just opportunity. Start drafting.',
  },
  /** CoachCommunityCohortsScreen — no cohorts yet. */
  cohorts: {
    crop: 'neutral',
    copy: 'No cohorts yet. The first one you build is the one your clients remember.',
  },
  /** CoachCommunityCohortDetailScreen — cohort with no members yet. */
  cohortMembers: {
    crop: 'neutral',
    copy: 'This cohort is waiting. Invite the first client when you are ready. — Roman',
  },
  /** CoachCommunityModerationScreen — queue cleared (celebratory). */
  moderation: {
    crop: 'smile',
    copy: 'Nothing flagged. The room is running itself.',
  },
} as const satisfies Record<string, CoachVoiceEntry>;

export type CoachEmptyKey = keyof typeof COACH_EMPTY_COPY;
