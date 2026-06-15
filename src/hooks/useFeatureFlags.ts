/**
 * useFeatureFlags — server-evaluated feature flags (D5=B+γ).
 *
 * The mobile client asks the backend (`GET /me/feature-flags`, backend PR #414)
 * which flagged community surfaces are live for the authenticated caller. The
 * server evaluates each flag from its own env gate + per-caller allowlist +
 * role, so this hook is the single runtime source of truth for the four v3-4
 * community flags. Role-gated flags (e.g. `coach_community_wearable_prompts`)
 * already resolve to OFF server-side for non-coach roles — the client does NOT
 * re-apply client-side role gating for those flags; it trusts the server.
 *
 * Posture:
 *   - TanStack Query, `staleTime` 5 min, so a freshly-fetched map is reused
 *     across screens without refetching on every mount.
 *   - Refetches on app foreground via an `AppState` listener (the RN equivalent
 *     of `refetchOnWindowFocus`), so a flag flipped server-side takes effect on
 *     the next resume rather than only on a cold start.
 *   - FAIL-SAFE: while loading or on error, every flag reads `false`. A failed
 *     flags fetch must NEVER enable a gated surface. The local static
 *     `featureFlags.*` build-time kill switch in `config/featureFlags.ts`
 *     remains the outer gate (it controls route REGISTRATION); this hook is the
 *     inner, server-authoritative RUNTIME gate consumed by the screens/hooks.
 *
 * A flag absent from the server map is treated as OFF (the schema permits any
 * string→boolean entries; missing keys default off here).
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  featureFlagsApi,
  type FeatureFlagsResponse,
  type ServerFeatureFlagKey,
} from '../api/featureFlagsApi';

/** 5 minutes — the brief's cache window. */
export const FEATURE_FLAGS_STALE_TIME_MS = 5 * 60 * 1000;

export const featureFlagsKeys = {
  all: ['me', 'feature-flags'] as const,
};

/** The resolved, typed boolean map the screens read (fail-safe OFF). */
export type ResolvedFeatureFlags = Record<ServerFeatureFlagKey, boolean>;

export interface UseFeatureFlagsResult {
  /** Typed boolean map for the four community v3-4 flags (OFF until loaded). */
  flags: ResolvedFeatureFlags;
  isLoading: boolean;
  isError: boolean;
  /** The raw server response (or undefined before the first success). */
  data: FeatureFlagsResponse | undefined;
  refetch: UseQueryResult<FeatureFlagsResponse, Error>['refetch'];
}

/** Resolve a single key from the raw map, OFF when absent. */
function resolve(
  data: FeatureFlagsResponse | undefined,
  key: ServerFeatureFlagKey,
): boolean {
  return data?.flags?.[key] === true;
}

export function useFeatureFlags(): UseFeatureFlagsResult {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: featureFlagsKeys.all,
    queryFn: () => featureFlagsApi.getFeatureFlags(),
    staleTime: FEATURE_FLAGS_STALE_TIME_MS,
  });

  // Refetch on app foreground (RN equivalent of refetchOnWindowFocus). When the
  // app returns to the foreground we invalidate the stale flag map so a flag
  // flipped server-side takes effect on resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void qc.invalidateQueries({ queryKey: featureFlagsKeys.all });
      }
    });
    return () => sub.remove();
  }, [qc]);

  const data = query.data;
  const flags: ResolvedFeatureFlags = {
    community_search: resolve(data, 'community_search'),
    coach_community_wearable_prompts: resolve(
      data,
      'coach_community_wearable_prompts',
    ),
    community_classroom: resolve(data, 'community_classroom'),
    community_events: resolve(data, 'community_events'),
  };

  return {
    flags,
    isLoading: query.isLoading,
    isError: query.isError,
    data,
    refetch: query.refetch,
  };
}
