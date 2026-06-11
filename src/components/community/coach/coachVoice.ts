/**
 * coachVoice — TYPED FALLBACK for the v1-6 coach community empty states.
 *
 * The operator-locked face+voice contract (locked 2026-06-10) requires every
 * empty state to consume a backend payload `{ text, avatar_crop, surface_key,
 * voice_variant }` from `GET /community/coach/empty-states` (see
 * useCoachEmptyStates). These constants are NO LONGER the success-path source
 * of truth — the backend VoicePolicyService is.
 *
 * This module exists ONLY as a typed, OPT-IN offline-cache payload source. It
 * is NOT wired into the live render path: `useCoachEmptyStatePayload` (fixer R2,
 * BLOCKER 1) returns a stateful `{ status: 'loading' | 'error' | 'ready' }`
 * result and NEVER falls back to these constants — on loading it renders a
 * non-Roman skeleton, on error it renders `CoachErrorState`, and Roman copy is
 * rendered ONLY from the live backend payload. `getCoachEmptyStateFallback` is
 * retained for a future explicit offline-cache hydration mode (which must also
 * surface a visible "Offline mode" indicator and stamp `voice_variant:
 * 'legacy'` so a fallback render is observable); until that mode ships it has
 * no success-empty-state call-site. The grep gate
 * (`getCoachEmptyStateFallback\(`) therefore matches only this definition.
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
 * Build a fully-typed RomanCopyPayload fallback for a surface. NOT wired into
 * the live render path: the success-empty path renders the backend payload and
 * the error path renders `CoachErrorState` (see `useCoachEmptyStatePayload`).
 * This helper is retained ONLY for a future explicit, opt-in offline-cache
 * hydration mode (which must surface a visible "Offline mode" indicator). It is
 * stamped `voice_variant: 'legacy'` so any such fallback render is observable.
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
