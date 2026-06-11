/**
 * coachVoice — TYPED FALLBACK for the v1-6 coach community empty states.
 *
 * The operator-locked face+voice contract (locked 2026-06-10) requires every
 * empty state to consume a backend payload `{ text, avatar_crop, surface_key,
 * voice_variant }` from `GET /community/coach/empty-states` (see
 * useCoachEmptyStates). These constants are NO LONGER the success-path source
 * of truth — the backend VoicePolicyService is.
 *
 * This module exists ONLY to provide a typed, offline fallback for when the
 * empty-states network call ERRORS (network/5xx). On the success path the
 * screens render the backend payload verbatim and never read these constants.
 * Fallback payloads are stamped `voice_variant: 'legacy'` so analytics can tell
 * a fallback render apart from a live `roman_v2` render.
 *
 * Copy rules (ROMAN_VOICE_POLICY §4): no exclamation points, no emoji, no
 * "Oops/Whoops/Uh oh", one next step per message, optional `— Roman` sign-off
 * on multi-line copy, never `— The TGP Team`. These strings mirror the backend
 * LEGACY map so a fallback render is indistinguishable in copy from the live
 * payload — only the analytics variant differs.
 */
import type {
  CoachEmptyStateSurfaceKey,
  RomanCopyPayload,
} from '../../../api/coachCommunityApi';

/**
 * Offline fallback copy + crop per surface, keyed by the backend surface_key.
 * Mirrors the backend LEGACY_COPY / SURFACE_AVATAR_CROP maps.
 */
export const COACH_EMPTY_FALLBACK: Readonly<
  Record<CoachEmptyStateSurfaceKey, { crop: 'neutral' | 'smile'; copy: string }>
> = {
  coach_community_home_empty: {
    crop: 'neutral',
    copy: 'Quiet morning. When your cohorts need you, I will bring it here. — Roman',
  },
  coach_community_inbox_empty: {
    crop: 'neutral',
    copy: 'The inbox is clear. When something needs you, it will be here.',
  },
  coach_community_cohorts_empty: {
    crop: 'neutral',
    copy: 'No cohorts yet. The first one you build is the one your clients remember.',
  },
  coach_community_cohort_members_empty: {
    crop: 'neutral',
    copy: 'This cohort is waiting. Invite the first client when you are ready. — Roman',
  },
  coach_community_moderation_empty: {
    crop: 'smile',
    copy: 'Nothing flagged. The room is running itself.',
  },
};

/**
 * Build a fully-typed RomanCopyPayload fallback for a surface. ONLY used when
 * `useCoachEmptyStates()` returns an error — never on a successful 200.
 * Stamped `voice_variant: 'legacy'` so a fallback render is observable.
 */
export function getCoachEmptyStateFallback(
  surfaceKey: CoachEmptyStateSurfaceKey,
): RomanCopyPayload {
  const entry = COACH_EMPTY_FALLBACK[surfaceKey];
  return {
    text: entry.copy,
    avatar_crop: entry.crop,
    surface_key: surfaceKey,
    voice_variant: 'legacy',
  };
}
