/**
 * useWearableSamples — React Query hook over `wearablesSamplesApi.getSamples`.
 *
 * Mirrors the repo's data-hook conventions (see `useWearableConnections` for
 * the query pattern). The cache key encodes EVERY param that changes the
 * server result so two different windows / granularities / clients / provider
 * filters never collide on one cache entry:
 *
 *   ['wearables','samples',
 *     { bucket, metric, from, to, clientId, granularity, preferredOnly,
 *       providers, timezone }]
 *
 * Per the CPO React Query note (§3b), the persister buster is bumped to
 * `v2-samples` in App.tsx so a stale pre-samples cache is discarded on first
 * launch after this ships — that lives in App.tsx, not here.
 *
 * staleTime 60s / gcTime 5min: wearable series move on a minutes-to-hours
 * cadence, so re-opening the H&F screen within a minute serves cache instantly
 * (no refetch) while a cold open after a few minutes pulls fresh data.
 *
 * Two caller shapes are accepted (R1 P0 #4 — HK-3b contract compat):
 *   - LEGACY: { bucket, from, to, metric?, clientId?, granularity?,
 *              preferredOnly?, providers?, timezone? }
 *   - CONTRACT: { bucket, metric, range: { from, to }, granularity, providers,
 *              timezone, clientId?, preferredOnly? }
 * Both normalise to {@link GetSamplesParams}; the CONTRACT `range` is just an
 * explicit window object. A single overloaded signature keeps every existing
 * call site working while satisfying HK-3b's documented contract surface.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  wearablesSamplesApi,
  type GetSamplesParams,
  type SamplesResponse,
} from '../api/wearablesSamplesApi';

/** staleTime — the window within which a re-open serves cache without a refetch. */
export const WEARABLE_SAMPLES_STALE_MS = 60_000;
/** gcTime — how long an unsubscribed cache entry survives for instant tab-back. */
export const WEARABLE_SAMPLES_GC_MS = 5 * 60_000;

/**
 * The CONTRACT-shape args HK-3b's contract documents: a single `range` window
 * object instead of flat `from`/`to`. Everything else mirrors
 * {@link GetSamplesParams}. `range` is required in this shape so TypeScript can
 * discriminate it from the legacy (flat `from`/`to`) shape at the overload.
 */
export interface ContractSamplesArgs {
  readonly bucket: GetSamplesParams['bucket'];
  readonly range: { readonly from: string; readonly to: string };
  readonly metric?: GetSamplesParams['metric'];
  readonly clientId?: GetSamplesParams['clientId'];
  readonly granularity?: GetSamplesParams['granularity'];
  readonly preferredOnly?: GetSamplesParams['preferredOnly'];
  readonly providers?: GetSamplesParams['providers'];
  readonly timezone?: GetSamplesParams['timezone'];
}

/** Type guard: the contract shape carries a `range` window object. */
function isContractArgs(
  args: GetSamplesParams | ContractSamplesArgs,
): args is ContractSamplesArgs {
  return (
    typeof (args as ContractSamplesArgs).range === 'object' &&
    (args as ContractSamplesArgs).range !== null
  );
}

/**
 * Normalise either caller shape to the flat {@link GetSamplesParams} the API
 * client expects. Pure + exported so the overload behaviour is unit-testable.
 */
export function normalizeSampleArgs(
  args: GetSamplesParams | ContractSamplesArgs,
): GetSamplesParams {
  if (isContractArgs(args)) {
    return {
      bucket: args.bucket,
      from: args.range.from,
      to: args.range.to,
      metric: args.metric,
      clientId: args.clientId,
      granularity: args.granularity,
      preferredOnly: args.preferredOnly,
      providers: args.providers,
      timezone: args.timezone,
    };
  }
  return args;
}

/**
 * The canonical, fully-normalised cache key for a samples query. Exported so
 * the preference write-hook can surgically invalidate only the affected
 * queries and tests can assert key shape. Keys are objects (React Query does a
 * stable structural compare) — order of param fields is irrelevant.
 *
 * `providers` is normalised to a sorted joined string (so `[A,B]` and `[B,A]`
 * hit the SAME cache entry) and `timezone` is included — without these two,
 * two different provider-filtered / timezone variants would COLLIDE on one
 * cache entry and serve the wrong data (R1 P0 #4).
 */
export function wearableSamplesQueryKey(params: GetSamplesParams) {
  return [
    'wearables',
    'samples',
    {
      bucket: params.bucket,
      metric: params.metric ?? null,
      from: params.from,
      to: params.to,
      clientId: params.clientId ?? null,
      granularity: params.granularity ?? 'raw',
      preferredOnly: params.preferredOnly ?? true,
      providers:
        params.providers && params.providers.length > 0
          ? [...params.providers].sort().join(',')
          : null,
      timezone: params.timezone ?? null,
    },
  ] as const;
}

/** Root key prefix for ALL samples queries — used for broad invalidation. */
export const WEARABLE_SAMPLES_ROOT_KEY = ['wearables', 'samples'] as const;

/**
 * Read wearable time-series for a bucket/metric/window.
 *
 * `enabled` defaults to true but can be turned off while the window is being
 * computed (e.g. before a date range resolves) so we never fire a request with
 * an incomplete param set.
 *
 * Errors (400/403/503 from the backend, or a Zod drift) are NOT swallowed —
 * they surface as `query.error` so the screen can render the typed
 * "Couldn't reach health server" / "Showing your last synced data" states
 * (#36 no silent failures, brief §4.5).
 */
export function useWearableSamples(
  params: GetSamplesParams,
  options?: { enabled?: boolean },
): UseQueryResult<SamplesResponse, Error>;
export function useWearableSamples(
  args: ContractSamplesArgs,
  options?: { enabled?: boolean },
): UseQueryResult<SamplesResponse, Error>;
export function useWearableSamples(
  args: GetSamplesParams | ContractSamplesArgs,
  options?: { enabled?: boolean },
): UseQueryResult<SamplesResponse, Error> {
  const params = normalizeSampleArgs(args);
  return useQuery<SamplesResponse, Error>({
    queryKey: wearableSamplesQueryKey(params),
    queryFn: () => wearablesSamplesApi.getSamples(params),
    enabled: options?.enabled ?? true,
    staleTime: WEARABLE_SAMPLES_STALE_MS,
    gcTime: WEARABLE_SAMPLES_GC_MS,
  });
}
