/**
 * AI Gateway — mobile feature-flag shape.
 *
 * Separate from `src/config/featureFlags.ts` (PR #100, wave 11) so the AI
 * Gateway rollout can be flipped without touching wave-11 surfaces. Both
 * files use the `EXPO_PUBLIC_FF_*` env naming convention.
 *
 * Defaults are FAIL-CLOSED:
 *   - In production, every flag is OFF unless explicitly set.
 *   - In dev, the master flag is ON so engineers see the surface.
 *   - Per-capability flags default to OFF in *every* env so a single accidental
 *     master-on doesn't turn on every entry point at once.
 *
 * The master flag (`aiGatewayEnabled`) is the *client-side* gate. The backend
 * gateway has its own kill switch and per-capability gates; the mobile flag is
 * a secondary gate so we can hide a surface client-side even when the backend
 * would allow it. UI MUST treat the gateway as unavailable when either gate
 * is off.
 */

import type { AIGatewayCapability } from '../types/aiGateway';

const isDev =
  process.env.NODE_ENV !== 'production' &&
  !!(globalThis as { __DEV__?: boolean }).__DEV__;

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export interface AIGatewayFlags {
  // Master gate. When false, the entire AI Gateway client is short-circuited
  // and no requests are made. UI surfaces hide their entry points.
  aiGatewayEnabled: boolean;
  // Per-capability gates. Each is a secondary client-side filter; the
  // backend's capability list is still authoritative.
  capabilities: Record<AIGatewayCapability, boolean>;
  // Show the audit/source attribution chip on AI-generated content.
  // ON by default whenever the master flag is on — turning it off should be
  // a deliberate, audited operator decision (e.g. for a screenshot test).
  showSourceBadge: boolean;
}

export const aiGatewayFlags: AIGatewayFlags = {
  aiGatewayEnabled: envBool('EXPO_PUBLIC_FF_AI_GATEWAY', isDev),
  capabilities: {
    coach_brief_draft: envBool('EXPO_PUBLIC_FF_AI_COACH_BRIEF_DRAFT', false),
    client_path_summary: envBool(
      'EXPO_PUBLIC_FF_AI_CLIENT_PATH_SUMMARY',
      false,
    ),
    check_in_summary: envBool('EXPO_PUBLIC_FF_AI_CHECK_IN_SUMMARY', false),
    food_log_explain: envBool('EXPO_PUBLIC_FF_AI_FOOD_LOG_EXPLAIN', false),
  },
  showSourceBadge: envBool('EXPO_PUBLIC_FF_AI_SOURCE_BADGE', true),
};

/**
 * Convenience guard: capability is allowed only when BOTH the master flag
 * and the per-capability flag are on. Backend gating is still enforced
 * server-side; this is purely the mobile-side decision to surface the entry
 * point.
 */
export function isAIGatewayCapabilityAllowed(
  capability: AIGatewayCapability,
  flags: AIGatewayFlags = aiGatewayFlags,
): boolean {
  if (!flags.aiGatewayEnabled) return false;
  return !!flags.capabilities[capability];
}
