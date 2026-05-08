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
} as const;

export type FeatureFlagKey = keyof typeof featureFlags;

export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return featureFlags[key];
}

/**
 * Phase 9 — Notification center mock flag.
 * Set to true while the backend Phase 9 PR is not yet merged.
 * When true, all notification API calls use the in-memory mock store in
 * src/services/notificationsApi.ts.
 * When false, calls hit the real backend (EXPO_PUBLIC_API_URL must be set).
 *
 * env: EXPO_PUBLIC_NOTIFICATIONS_MOCK (optional — defaults to true)
 */
export const NOTIFICATIONS_MOCK_ENABLED: boolean = envBool(
  'EXPO_PUBLIC_NOTIFICATIONS_MOCK',
  true,
);
