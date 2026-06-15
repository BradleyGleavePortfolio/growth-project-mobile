/**
 * featureFlagsApi — typed client for the server-evaluated feature-flags
 * endpoint (D5=B+γ). The mobile app no longer decides whether a flagged
 * community surface is live from a local Expo env value alone; it asks the
 * server, which evaluates each flag from its own env gates + per-caller
 * allowlist + role, and returns a flag map.
 *
 * Backend contract source of truth (do NOT drift — see backend PR #414):
 *   growth-project-backend/src/feature-flags/feature-flags.controller.ts
 *   growth-project-backend/src/feature-flags/feature-flags.dto.ts
 *
 *   GET /me/feature-flags
 *   Auth: Bearer JWT (global JwtAuthGuard; no @Public)
 *   Throttle: 60/min/user
 *   200:
 *     {
 *       "flags": { [name: string]: boolean },
 *       "evaluated_at": "ISO8601"
 *     }
 *
 * Role-gated flags (e.g. `coach_community_wearable_prompts`) resolve to OFF
 * server-side for non-coach roles regardless of env — the client must NOT
 * re-apply client-side role gating for those flags; it trusts the server's
 * evaluation. A flag absent from the map is treated as OFF (fail-safe).
 *
 * Wire posture mirrors communitySearchApi.ts: every response is Zod-validated
 * at the boundary (`.strict()`), so a drifted shape THROWS here (wrapped as a
 * `contract` error) instead of feeding a malformed flag map into the app.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { CommunityApiError } from './communityApi';

/** Every network read carries an AbortSignal.timeout (mirror search slice). */
export const FEATURE_FLAGS_REQUEST_TIMEOUT_MS = 15_000;

/**
 * The four community v3-4 flag names the mobile client reads from the server
 * map. These are the snake_case keys the backend returns (NOT the camelCase
 * local `featureFlags` keys). Other flags may appear in the map; the client
 * only types the ones it consumes and treats any absent key as OFF.
 */
export const SERVER_FEATURE_FLAG_KEYS = [
  'community_search',
  'coach_community_wearable_prompts',
  'community_classroom',
  'community_events',
] as const;
export type ServerFeatureFlagKey = (typeof SERVER_FEATURE_FLAG_KEYS)[number];

// ─── Response schema (mirror backend Zod, snake_case wire shape) ─────────────

export const FeatureFlagsResponseSchema = z
  .object({
    flags: z.record(z.string(), z.boolean()),
    evaluated_at: z.string(),
  })
  .strict();
export type FeatureFlagsResponse = z.infer<typeof FeatureFlagsResponseSchema>;

// ─── Transport helper (mirrors communitySearchApi.call) ──────────────────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

async function call<T>(
  schema: z.ZodType<T>,
  fn: () => Promise<{ data: unknown }>,
): Promise<T> {
  let res: { data: unknown };
  try {
    res = await fn();
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 0;
      throw new CommunityApiError(
        classify(status),
        status,
        `feature-flags request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'feature-flags request failed',
      err,
    );
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CommunityApiError(
        'contract',
        200,
        'feature-flags response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const featureFlagsApi = {
  /**
   * Fetch the server-evaluated flag map for the authenticated caller. The
   * server resolves each flag from its env gate + allowlist + role; a non-coach
   * caller receives `coach_community_wearable_prompts: false` automatically.
   */
  async getFeatureFlags(): Promise<FeatureFlagsResponse> {
    return call(FeatureFlagsResponseSchema, () =>
      api.get<unknown>('/me/feature-flags', {
        timeout: FEATURE_FLAGS_REQUEST_TIMEOUT_MS,
      }),
    );
  },
};
