/**
 * posthog.service.ts — Typed PostHog wrapper for The Growth Project mobile app.
 *
 * Provides:
 *   - track(event, props?)   — fire a named event with PII-stripped properties
 *   - identify(user)         — associate events with an opaque server-side user ID
 *   - useFeatureFlag(name)   — React hook; re-exports from posthog-react-native
 *   - reset()                — clear PostHog state on sign-out
 *
 * All calls are guarded: the service never throws.
 * When EXPO_PUBLIC_POSTHOG_API_KEY (or the legacy EXPO_PUBLIC_POSTHOG_KEY)
 * is absent the service is a silent no-op — safe in CI and local dev.
 *
 * Architecture note:
 *   The low-level PostHog client lives in src/lib/analytics.ts (legacy wrapper).
 *   This service is the Phase 11 typed layer on top of it, adding:
 *     - AnalyticsEventName union enforcement
 *     - typed user identity shape
 *     - feature-flag re-export for convenience
 */

import { track as rawTrack, identify as rawIdentify, reset as rawReset } from '../lib/analytics';
import { usePostHog } from 'posthog-react-native';
import type { AnalyticsEventName } from './events';

// ─── User identity ────────────────────────────────────────────────────────────

/** Opaque identity shape. Never includes PII — only server IDs and role. */
export interface AnalyticsUser {
  /** Server-issued UUID (not email, not phone). */
  userId: string;
  /** App role for segmentation in PostHog. */
  role?: 'client' | 'coach' | 'admin';
  /** Tenant slug for multi-coach installs. */
  coachTenantId?: string;
  /** Whether the user is a founding member (for cohort analysis). */
  isFoundingMember?: boolean;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Track a typed event with optional props.
 * Props are PII-stripped inside the underlying analytics service.
 */
export function track(
  event: AnalyticsEventName,
  props?: Record<string, unknown>,
): void {
  rawTrack(event, props);
}

/**
 * Associate subsequent events with the given user identity.
 * Safe to call on every auth-state change — PostHog deduplicates.
 */
export function identify(user: AnalyticsUser): void {
  rawIdentify(user.userId, {
    role: user.role,
    coach_tenant_id: user.coachTenantId,
    is_founding_member: user.isFoundingMember,
  });
}

/**
 * Reset PostHog state on sign-out.
 * Call from authActions.signOut() so subsequent events get a fresh anonymous ID.
 */
export function reset(): void {
  rawReset();
}

/**
 * React hook: returns the current value of a PostHog feature flag.
 * Returns undefined when the SDK is not initialised or the flag is unknown.
 *
 * Usage:
 *   const flagValue = useFeatureFlag('new_share_card_ui');
 *   if (flagValue === true) { ... }
 *
 * Re-exported from posthog-react-native so callers only need this module.
 */
export function useFeatureFlag(flagName: string): boolean | string | undefined {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const posthog = usePostHog();
  if (!posthog) return undefined;
  try {
    return posthog.getFeatureFlag(flagName) as boolean | string | undefined;
  } catch {
    return undefined;
  }
}
