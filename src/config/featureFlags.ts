/**
 * featureFlags.ts — Centralised feature toggles.
 *
 * Surfaces introduced behind flags are NOT YET WIRED to live endpoints.
 * Each surface is gated here so the production build can ship the
 * scaffolding without exposing empty states to clients/coaches.
 *
 * Resolution order:
 *   1. Explicit `EXPO_PUBLIC_*` env var (string "true" or "1" enables).
 *   2. Default value below.
 *
 * Wave 11 flags default OFF in production, ON when __DEV__ is true so
 * local builds can preview the scaffolding without env juggling.
 *
 * Bloodwork flag defaults OFF unconditionally — flip on per build once
 * backend storage, audit log, and consent capture are live.
 */

const isDev =
  process.env.NODE_ENV !== 'production' &&
  !!(globalThis as { __DEV__?: boolean }).__DEV__;

function readFlag(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

/** Centralised, typed flag map. Add new flags here as new surfaces land. */
export const featureFlags = {
  // ─── Bloodwork ────────────────────────────────────────────────────────────
  /**
   * Client-entered bloodwork / labs review surface. OFF by default —
   * flip on per build (or remotely, once a remote-config layer lands)
   * once backend storage, audit log, and consent capture are live.
   *
   * env: EXPO_PUBLIC_FEATURE_BLOODWORK
   */
  bloodwork: readFlag('EXPO_PUBLIC_FEATURE_BLOODWORK', false),

  // ─── Wave 11 — runtime scaffolding ───────────────────────────────────────
  /** Client Path Copilot — AI summaries + drafts on the client home tab. */
  clientPathCopilot: readFlag('EXPO_PUBLIC_FF_CLIENT_PATH_COPILOT', isDev),
  /** Coach Brief — daily morning brief on the coach home tab. */
  coachBrief: readFlag('EXPO_PUBLIC_FF_COACH_BRIEF', isDev),
  /** Admin Control Room — governance view, gated to admin role. */
  adminControlRoom: readFlag('EXPO_PUBLIC_FF_ADMIN_CONTROL_ROOM', isDev),
  /** Private community hub — rooms, cohorts, announcements, coach-led threads. */
  privateCommunityHub: readFlag('EXPO_PUBLIC_FF_PRIVATE_COMMUNITY_HUB', isDev),
  /** Voice-note attachment surfaces inside the community hub. Stays OFF
   *  even in dev until the upload pipeline ships, to avoid suggesting the
   *  feature is available. */
  communityVoiceNotes: readFlag('EXPO_PUBLIC_FF_COMMUNITY_VOICE_NOTES', false),
  /** Verified-progress signoff surfaces. Coach + client see status chips
   *  and submission flow even before the backend signoff endpoints land. */
  verifiedProgressSignoff: readFlag(
    'EXPO_PUBLIC_FF_VERIFIED_PROGRESS_SIGNOFF',
    isDev,
  ),

  // ─── PR-13 / PR-15B — Buyer-facing Deliverables timeline + Purchase unpack ─
  /**
   * Buyer-facing Deliverables CTA on `ClientPackagesScreen`, the
   * `DeliverablesScreen` it routes into, and the post-checkout
   * `PurchaseUnpackScreen` (PR-15B).
   *
   * Default posture:
   *   • __DEV__              → ON (`isDev` fallback) so the screens are
   *                            reachable for local development against
   *                            the live PR-15A endpoint or a stub.
   *   • Production / staging → OFF until ops flips
   *                            `EXPO_PUBLIC_FF_DELIVERABLES=true` once
   *                            PR-15A
   *                            (`GET /v1/checkout/purchases/:purchaseId/drops`)
   *                            is deployed. The mobile client is wired
   *                            to gracefully degrade if the endpoint is
   *                            absent (404/501 → calm "deliverables
   *                            coming" state, never an error banner),
   *                            but keeping the flag OFF until rollout
   *                            avoids surfacing the unpack screen at all
   *                            before the contract is live.
   *
   * PR-15B does NOT change the prod default — the rollout toggle stays
   * with ops. Only the docstring is updated; the `isDev` fallback was
   * already the intended dev posture.
   *
   * env: EXPO_PUBLIC_FF_DELIVERABLES
   */
  deliverables: readFlag('EXPO_PUBLIC_FF_DELIVERABLES', isDev),

  // ─── Community v1-5 — mobile client tab ──────────────────────────────────
  // The v1-4 backend (realtime / push / telemetry) is merged; v1-5 is the
  // client mobile surface that consumes it. ALL FOUR flags default OFF
  // UNCONDITIONALLY (not `isDev`) — when the master tab flag is false the
  // Community tab MUST NOT appear in ClientNavigator and its deep-link route
  // MUST NOT register. v1-5 is otherwise dead code at build time. The backend
  // gates are also OFF in prod (FEATURE_COMMUNITY_*), so a dev build that
  // flips these on still degrades gracefully to a calm empty state.

  /** Master Community tab on/off. OFF → no tab, no deep-link route. */
  communityTab: readFlag('EXPO_PUBLIC_FF_COMMUNITY_TAB', false),
  /** Hall space type (coach-wide announcements + cohort posts). */
  communityHall: readFlag('EXPO_PUBLIC_FF_COMMUNITY_HALL', false),
  /** Cohort spaces (coach-defined groups / training blocks). */
  communityCohorts: readFlag('EXPO_PUBLIC_FF_COMMUNITY_COHORTS', false),
  /** Direct messages (client↔coach and client↔client per §2.10 gates). */
  communityDm: readFlag('EXPO_PUBLIC_FF_COMMUNITY_DM', false),

  // ─── Community v1-6 — mobile coach surface ───────────────────────────────
  // The v1-6 backend (community-cohort-write, community-cohort-members,
  // community-coach-inbox controllers) is merged; v1-6 is the coach-only
  // mobile surface that consumes it: a coach home, aggregated inbox, private
  // drafting lab, cohort management, cohort detail, and a moderation queue.
  //
  // Defaults OFF UNCONDITIONALLY (not `isDev`). When this flag is false the
  // coach navigator MUST NOT register the six CoachCommunity routes and the
  // coach lands on the existing home as today. When true the six routes
  // register and a Community tab appears in the coach bottom nav. The backend
  // gates are also OFF in prod, so a dev build that flips this on still
  // degrades gracefully to a calm Roman-voiced empty state.
  //
  // env: EXPO_PUBLIC_FF_COACH_COMMUNITY
  coachCommunity: readFlag('EXPO_PUBLIC_FF_COACH_COMMUNITY', false),

  // ─── Community v2-2 — coach ack signals + inbox SLA ──────────────────────
  // The v2-2 backend (FEATURE_COMMUNITY_ACKS) adds explicit coach ack-signal
  // transitions (seen -> acked -> replied) plus a read-time SLA snapshot per
  // message. This mobile flag gates the coach-side surface that consumes them:
  // the CoachAckBadge on each inbox row and the per-row "Mark acked"
  // quick-action. Defaults OFF UNCONDITIONALLY (not `isDev`). When false the
  // inbox renders exactly as the v1-6 surface does today (no badge, no
  // quick-action) so the kill switch hides the new UI without breaking the
  // existing inbox. The backend gate is also OFF in prod, so a dev build that
  // flips this on still degrades gracefully.
  //
  // env: EXPO_PUBLIC_FF_COMMUNITY_ACKS
  communityAcks: readFlag('EXPO_PUBLIC_FF_COMMUNITY_ACKS', false),

  // ─── Community v2-4 — AI inbox triage ──────────────────────────
  // The v2-4 backend (FEATURE_COMMUNITY_AI_TRIAGE) adds a read-only AI
  // inbox-triage endpoint (GET /community/ai-triage) that sorts a coach's
  // unanswered community inbox into five fixed categories. This mobile flag
  // gates the coach-side surface that consumes it: a single AiTriageCard
  // banner above the inbox list, visually distinct from human rows and clearly
  // labelled AI-generated. Defaults OFF UNCONDITIONALLY (not `isDev`). When
  // false the inbox renders exactly as it does today (no triage card, no
  // triage fetch) so the kill switch hides the new UI without disturbing the
  // v1-6 inbox or the v2-2 ack surface. The backend gate is also OFF in prod
  // and answers a byte-identical 404 when off, so a dev build that flips this
  // on still degrades gracefully to a calm, typed state.
  //
  // env: EXPO_PUBLIC_FF_COMMUNITY_AI_TRIAGE
  communityAiTriage: readFlag('EXPO_PUBLIC_FF_COMMUNITY_AI_TRIAGE', false),

  // ─── Community v2-3 — event objects (client RSVP + coach lifecycle) ───────
  // The v2-3 backend (community/events controller — create / list / detail /
  // edit / transition / rsvp / replay / reflect) is behind FEATURE_COMMUNITY_
  // EVENTS. This flag gates the matching mobile surface: the client event
  // detail (RSVP + external link) and the coach event list + lifecycle screen.
  //
  // Defaults OFF UNCONDITIONALLY (not `isDev`). When false, the
  // CommunityEventDetail / CoachCommunityEvents routes are NOT registered on
  // the (already flag-gated) community stacks at all — the route screens are
  // wrapped in a `featureFlags.communityEvents && ...` guard in both navigators
  // — so there is zero event UI, no navigator target, and no reachable event
  // surface. Consuming surfaces also read this flag before exposing entry
  // points (discovery cards), giving belt-and-braces containment.
  // There is NO native live room — events carry an external, host-allowlisted
  // link only (Step 0).
  //
  // env: EXPO_PUBLIC_FF_COMMUNITY_EVENTS
  communityEvents: readFlag('EXPO_PUBLIC_FF_COMMUNITY_EVENTS', false),
  romanChat: readFlag('EXPO_PUBLIC_FF_ROMAN_CHAT', false),
  /**
   * Roman P4 / ED.3 — First Payment Wow Screen (coach app). Mobile mirror of
   * the backend's FEATURE_ROMAN_FIRST_PAYMENT gate (Option C —
   * ROMAN_ED3_REWRITE_PLAN.md). When ON, the coach shell subscribes to the
   * backend's FIRST_PAYMENT domain notification (useFirstPaymentNotification)
   * and overlays the celebration screen once (MMKV once-only gate). The mobile
   * client no longer reads the ClientPurchase table directly — the backend owns
   * the first-payment decision and emits a normal notification. Default OFF
   * (production-safe scaffolding); flip on per build once the backend
   * FIRST_PAYMENT emitter is live. Both old and new paths are killable from the
   * server via the backend gate.
   *
   * env: EXPO_PUBLIC_FF_ROMAN_FIRST_PAYMENT_WOW
   */
  romanFirstPaymentWow: readFlag('EXPO_PUBLIC_FF_ROMAN_FIRST_PAYMENT_WOW', false),
  /**
   * Roman P4 / ED.4 — Bodyweight progress chart polish (client app). When ON,
   * the client ProgressScreen mounts the ED.4 `ProgressChartCard` (the SVG +
   * Reanimated draw-in chart with the haptic scrubber) for the weight trend.
   * When OFF, the screen renders the legacy chart/empty state and never mounts
   * the ED.4 animated surface (audit R5 P2 — ED.4 must be flag-gated, with the
   * legacy behaviour preserved off). Default OFF (production-safe scaffolding);
   * flip on per build once the ED.4 polish is signed off.
   *
   * env: EXPO_PUBLIC_FF_ROMAN_BODYWEIGHT_POLISH
   */
  romanFirstPaymentBodyweightPolish: readFlag(
    'EXPO_PUBLIC_FF_ROMAN_BODYWEIGHT_POLISH',
    false,
  ),
  // NOTE (roman-p4 / Option C): the former
  // `romanFirstPaymentRequireBackendHistory` forward-hook flag
  // (EXPO_PUBLIC_FF_ROMAN_REQUIRE_BACKEND_HISTORY) was removed. It was a
  // band-aid for the client-side ClientPurchase same-row replay problem, which
  // no longer exists now that the backend owns the first-payment decision and
  // the mobile client only reacts to the FIRST_PAYMENT notification.

  // ─── Community v3-1 — opt-in challenges ──────────────────────────────────
  // Cohort challenges with personal-progress logging and a STRICTLY OPT-IN,
  // cohort-local leaderboard. Defaults OFF UNCONDITIONALLY (not `isDev`): when
  // false the CommunityChallengeDetail route MUST NOT register and the screen
  // is dead code at build time. The backend gate (FEATURE_COMMUNITY_CHALLENGES)
  // is also OFF in prod, so a dev build that flips this on degrades gracefully.
  //
  // env: EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES
  communityChallenges: readFlag('EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES', false),

  // ─── Community v3-2 — classroom posts (media-backed lessons) ─────────────
  // Coach-authored, media-backed lessons (video/audio/pdf/image) with a
  // release-time lock and pinned ordering. This mobile flag gates the
  // READ-ONLY student surface: the CommunityClassroom feed + the
  // CommunityLessonDetail screen. Defaults OFF UNCONDITIONALLY (not `isDev`):
  // when false neither route registers and both screens are dead code at build
  // time. The backend gate (FEATURE_COMMUNITY_CLASSROOM_POSTS) is also OFF in
  // prod and gates the write routes, so a dev build that flips this on still
  // degrades gracefully to a calm empty/not-available state.
  //
  // env: EXPO_PUBLIC_FF_COMMUNITY_CLASSROOM_POSTS
  communityClassroom: readFlag(
    'EXPO_PUBLIC_FF_COMMUNITY_CLASSROOM_POSTS',
    false,
  ),

  // ─── Community v3-4 — search + wearable-aware coaching prompts ───────────
  // Two paired surfaces consuming the v3-4 backend (FEATURE_COMMUNITY_SEARCH +
  // FEATURE_COMMUNITY_WEARABLE_PROMPTS):
  //   • communitySearch — the CommunityFindScreen (search posts / lessons /
  //     voice-note transcripts / events across the workspace, RLS-scoped).
  //   • communityWearablePrompts — the COACH-ONLY CommunityWearablePromptsScreen
  //     (AI coaching prompts sourced from already-opted-in wearable insights;
  //     never surfaced to clients).
  // Both default OFF UNCONDITIONALLY (not `isDev`): when false neither route
  // registers and both screens are dead code at build time. The backend gates
  // are also OFF in prod, so a dev build that flips these on still degrades
  // gracefully to a calm empty / not-available state.
  //
  // env: EXPO_PUBLIC_FF_COMMUNITY_SEARCH
  communitySearch: readFlag('EXPO_PUBLIC_FF_COMMUNITY_SEARCH', false),
  // env: EXPO_PUBLIC_FF_COMMUNITY_WEARABLE_PROMPTS
  communityWearablePrompts: readFlag(
    'EXPO_PUBLIC_FF_COMMUNITY_WEARABLE_PROMPTS',
    false,
  ),
  // ─── MWB-4 — workout-builder autosave (Google-Docs-style save) ───────────
  // The MWB-3 backend (PATCH /workout-plans/:planId/autosave + POST .../undo,
  // FEATURE_MWB_AUTOSAVE_UNDO) is merged; MWB-4 is the mobile half: a reusable
  // useAutosave hook, an AsyncStorage offline mirror that lets an edit survive
  // an app kill and replay on reconnect, a strict-Zod autosave API layer, and a
  // calm save-state header pill on the coach workout builder.
  //
  // Defaults OFF UNCONDITIONALLY (not `isDev`). When this flag is false the
  // CoachWorkoutBuilderScreen MUST behave byte-identically to its legacy
  // explicit-Save (PUT replace-all) form: zero autosave network calls, zero
  // offline-mirror writes, and no save-state pill rendered. The backend gate
  // (FEATURE_MWB_AUTOSAVE_UNDO) is ALSO off in prod and returns 404 for the
  // autosave route while dark, so even a dev build that flips this flag on
  // degrades to a calm offline/`gone` state rather than an error banner.
  //
  // env: EXPO_PUBLIC_FF_MWB_AUTOSAVE
  mwbAutosave: readFlag('EXPO_PUBLIC_FF_MWB_AUTOSAVE', false),
  // ─── Roman P3 — backend-authority gates ──────────────────────────────────
  // Two P3 Roman surfaces speak from signals the backend `main` does NOT yet
  // expose authoritatively, so each is held behind its own backend-live gate
  // (separate from the master `romanChat` flag). Both default OFF
  // UNCONDITIONALLY so the proxy-signal surfaces stay hidden until the backend
  // ships the real field — flip the matching env var to `true` only once the
  // authoritative contract is live.

  /**
   * §2.4 Coach-brief check-in notice. The host currently derives the notice
   * from a mobile-only Wave 11 scaffold (`latestVerifiedProgress.kind ===
   * 'check_in_consistency'`) that backend `main` does not return. Keep the
   * §2.4 surface hidden until backend `main` exposes an authoritative
   * `latestVerifiedProgress` check-in claim field. OFF until then.
   *
   * env: EXPO_PUBLIC_FF_ROMAN_CHECKIN_BACKEND_LIVE
   */
  romanCheckInBackendLive: readFlag(
    'EXPO_PUBLIC_FF_ROMAN_CHECKIN_BACKEND_LIVE',
    false,
  ),
  /**
   * §2.7 client streak milestone card. The host currently derives the
   * milestone tier from a client-side recomputed logging count, which is not
   * an authoritative backend milestone event. Keep the §2.7 card hidden until
   * the backend exposes an authoritative streak-milestone event (event id,
   * date, tier). OFF until then.
   *
   * env: EXPO_PUBLIC_FF_ROMAN_STREAK_BACKEND_LIVE
   */
  romanStreakBackendLive: readFlag(
    'EXPO_PUBLIC_FF_ROMAN_STREAK_BACKEND_LIVE',
    false,
  ),

  // ─── Roman ED.6 — coach-is-watching competence pill ──────────────────────
  /**
   * ED.6 competence pill ("Your coach reviewed this {relative}."). When OFF the
   * CompetencePill renders nothing on ClientCheckInScreen / ClientMessageScreen
   * even if a real coach_reviewed_at timestamp is present. The backend write
   * path is gated independently by FEATURE_ROMAN_COACH_REVIEWED_AT, so this
   * flag can ship asymmetrically: mobile ON + backend OFF → field always null →
   * pill never renders → no behaviour change. Default OFF UNCONDITIONALLY (not
   * `isDev`) so a dev build never surfaces the pill before the backend lands.
   *
   * env: EXPO_PUBLIC_FF_ROMAN_COMPETENCE_PILL
   */
  romanCompetencePill: readFlag('EXPO_PUBLIC_FF_ROMAN_COMPETENCE_PILL', false),

  // ─── Roman ED.2 — three-arc check-in / brief / review router ─────────
  /**
   * ED.2 three-arc router widget on Coach Home — three completion arcs
   * (check-ins reviewed, brief opened, threads reviewed) that deep-link into
   * the matching coach surfaces on tap. When OFF the CoachThreeArcRouter is
   * NOT mounted on CoachHomeScreen at all (no fetch, no render). The backend
   * counts endpoint is gated independently by FEATURE_ROMAN_THREE_ARC_COUNTS,
   * so this can ship asymmetrically: mobile ON + backend OFF → endpoint returns
   * a zeroed shape → three empty rings → no behaviour change. Default OFF
   * UNCONDITIONALLY (not `isDev`) so a dev build never surfaces the widget
   * before the backend lands.
   *
   * env: EXPO_PUBLIC_FF_ROMAN_THREE_ARC_ROUTER
   */
  romanThreeArcRouter: readFlag('EXPO_PUBLIC_FF_ROMAN_THREE_ARC_ROUTER', false),
} as const;

export type FeatureFlagKey = keyof typeof featureFlags;

export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return featureFlags[key];
}

/**
 * Phase 9 — Notification center mock flag.
 * When true, all notification API calls use the in-memory mock store in
 * src/services/notificationsApi.ts. When false, calls hit the real backend
 * at EXPO_PUBLIC_API_URL.
 *
 * Default OFF (production-safe). Demo / screenshot builds opt in via the env
 * var. Production is hard-pinned to "false" in eas.json so a release binary
 * can never accidentally ship with the mock store.
 *
 * env: EXPO_PUBLIC_NOTIFICATIONS_MOCK
 */
export const NOTIFICATIONS_MOCK_ENABLED = __DEV__ && readFlag('EXPO_PUBLIC_NOTIFICATIONS_MOCK', false);
