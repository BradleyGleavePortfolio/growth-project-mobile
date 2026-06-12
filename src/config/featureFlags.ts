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
