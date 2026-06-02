/**
 * wearablesSamplesApi — typed client for the wearable SAMPLES + PREFERENCES
 * API (mobile side of backend PR-HK-3a).
 *
 * Backend contract source of truth (binding — do NOT drift):
 *   growth-project-backend/src/wearables/samples/wearable-samples.controller.ts
 *   growth-project-backend/src/wearables/samples/dto/sample-response.schema.ts
 *   growth-project-backend/src/wearables/samples/dto/get-samples.query.ts
 *   growth-project-backend/src/wearables/preferences/preferences.controller.ts
 *   growth-project-backend/src/wearables/preferences/dto/upsert-preference.dto.ts
 *
 * Endpoints:
 *   - GET    /v1/wearables/samples         → SamplesResponse  (time-series read)
 *   - POST   /v1/wearables/preferences     → PreferenceResult (preferred-source upsert)
 *   - DELETE /v1/wearables/preferences/:metric → DeletePreferenceResult
 *
 * LOCK NOTE (§3b): this is the SHARED client. HK-3b imports `SamplesResponse`,
 * `getSamples`, and the preference methods for Sleep & Recovery metrics and
 * MUST NOT widen the response shape — both buckets ride the exact same wire
 * contract. If the backend response grows a field, mirror it HERE once.
 *
 * Every response is validated with Zod at the wire boundary (#8 phantom
 * validation / #17 fake confidence): a shape that drifts from the backend DTO
 * THROWS a ZodError here instead of feeding a malformed object into React
 * state. Datetimes are kept as ISO strings (the UI humanizes relative times);
 * a malformed date then surfaces in the formatting layer, not as a parse throw.
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { logger } from '../utils/logger';
import {
  WEARABLE_PROVIDERS,
  type WearableProvider,
} from './wearablesConnectionsApi';

// ─── Canonical enums (mirror of backend Prisma enums) ────────────────────────

/**
 * Canonical metric buckets. Mirrors backend `WearableMetricBucket`. The two
 * buckets drive the shell's Fitness | Recovery switcher.
 */
export const WEARABLE_METRIC_BUCKETS = [
  'HEALTH_FITNESS',
  'SLEEP_RECOVERY',
] as const;

export type WearableMetricBucket = (typeof WEARABLE_METRIC_BUCKETS)[number];

/**
 * Canonical metric ids. MUST mirror the backend `WearableMetricType` enum
 * (growth-project-backend prisma schema + samples/metric-bucket.map.ts). The
 * ordering is irrelevant to the wire; what matters is the exact value set so a
 * drift trips the Zod parse instead of silently dropping a series.
 *
 * `SLEEP_DURATION_MIN` / `SLEEP_ONSET_ISO` / `SLEEP_WAKE_ISO` are the
 * sleep-bucket metrics consumed by HK-3b (PR #223) `recoveryData` (sleep
 * deficit + consistency). The backend enum add for these ships in the same
 * PR-HK-3a coordination line; the mobile mirror is added here so the shared
 * client typechecks for HK-3b. Onset/wake carry a numeric value = local
 * minutes-of-day (see HK-3b `sleepConsistency`).
 */
export const WEARABLE_METRIC_TYPES = [
  // Health & Fitness
  'STEPS',
  'ACTIVE_ENERGY_KCAL',
  'RESTING_HEART_RATE_BPM',
  'HEART_RATE_BPM',
  'VO2_MAX',
  'WORKOUT_DURATION_MIN',
  'WORKOUT_DISTANCE_M',
  'TRAINING_LOAD',
  'BODY_WEIGHT_KG',
  'BODY_FAT_PCT',
  'BLOOD_PRESSURE_SYS',
  'BLOOD_PRESSURE_DIA',
  // Sleep & Recovery
  'SLEEP_DURATION_MIN',
  'SLEEP_TOTAL_MIN',
  'SLEEP_REM_MIN',
  'SLEEP_DEEP_MIN',
  'SLEEP_LIGHT_MIN',
  'SLEEP_AWAKE_MIN',
  'SLEEP_EFFICIENCY_PCT',
  'SLEEP_ONSET_ISO',
  'SLEEP_WAKE_ISO',
  'HRV_MS',
  'RECOVERY_SCORE',
  'READINESS_SCORE',
  'STRAIN_SCORE',
  'BODY_BATTERY',
  'BODY_TEMP_DEVIATION_C',
  'RESPIRATORY_RATE_BRPM',
  'SPO2_PCT',
] as const;

export type WearableMetricType = (typeof WEARABLE_METRIC_TYPES)[number];

/**
 * Read granularity. `raw` returns individual samples; `hour`/`day` add a
 * server-side `date_trunc` aggregation (`buckets[]`). Mirrors the backend
 * query enum.
 */
export const SAMPLE_GRANULARITIES = ['raw', 'hour', 'day'] as const;
export type SampleGranularity = (typeof SAMPLE_GRANULARITIES)[number];

/**
 * Freshness status per connected provider. Mirrors backend
 * `FRESHNESS_STATUSES`. Drives the freshness chip's aggregate copy — though
 * the chip itself is ALSO derived client-side from `useWearableConnections`
 * (plan line 91), this server field is the authoritative per-provider sync
 * timestamp for the Metric Detail "last synced" line.
 */
export const SAMPLE_FRESHNESS_STATUSES = [
  'current',
  'needs_attention',
  'never_synced',
] as const;

export type SampleFreshnessStatus = (typeof SAMPLE_FRESHNESS_STATUSES)[number];

// ─── Zod schemas (runtime validation at the wire boundary) ───────────────────

const providerSchema = z.enum(WEARABLE_PROVIDERS);
const metricSchema = z.enum(WEARABLE_METRIC_TYPES);
const bucketSchema = z.enum(WEARABLE_METRIC_BUCKETS);

/**
 * A single raw sample. Backend serializes `start_at`/`end_at` as ISO-8601
 * strings; `value` is a finite number (the backend stores a numeric column).
 * We require `finite` so a `NaN`/`Infinity` that somehow slipped the wire
 * (corrupt JSON, upstream bug) fails the parse rather than corrupting a chart.
 */
const sampleSchema = z.object({
  start_at: z.string(),
  end_at: z.string(),
  value: z.number().finite(),
  provider: providerSchema,
});

export type SampleDatum = z.infer<typeof sampleSchema>;

/** An aggregated bucket — present only when granularity !== 'raw'. */
const aggBucketSchema = z.object({
  bucket_start: z.string(),
  bucket_end: z.string(),
  agg: z.number().finite(),
  count: z.number().int().nonnegative(),
});

export type AggBucket = z.infer<typeof aggBucketSchema>;

/** One metric's series within the response. */
const seriesSchema = z.object({
  metric: metricSchema,
  unit: z.string(),
  /** null when the series has zero samples in the window. */
  provider_used: providerSchema.nullable(),
  sample_count: z.number().int().nonnegative(),
  samples: z.array(sampleSchema),
  /** present only when granularity !== 'raw'. */
  buckets: z.array(aggBucketSchema).optional(),
});

export type SampleSeries = z.infer<typeof seriesSchema>;

/** One connected provider's freshness entry — drives the freshness chip copy. */
const freshnessProviderSchema = z.object({
  provider: providerSchema,
  last_synced_at: z.string().nullable(),
  status: z.enum(SAMPLE_FRESHNESS_STATUSES),
});

export type FreshnessProvider = z.infer<typeof freshnessProviderSchema>;

/**
 * The locked `GET /v1/wearables/samples` 200 response. `.strict()` mirrors the
 * backend's `.strict()` — an UNEXPECTED extra field is a contract drift and
 * fails the parse loudly here (we never silently swallow server additions; a
 * deliberate new field is added to BOTH schemas in lock-step).
 */
export const samplesResponseSchema = z
  .object({
    version: z.literal(1),
    user_id: z.string(),
    bucket: bucketSchema,
    window: z.object({ from: z.string(), to: z.string() }),
    series: z.array(seriesSchema),
    freshness: z.object({ providers: z.array(freshnessProviderSchema) }),
  })
  .strict();

export type SamplesResponse = z.infer<typeof samplesResponseSchema>;

// ─── HK-3b contract aliases (shared client surface) ──────────────────────────
//
// HK-3b (PR #223) imports the response + series types under a `Wearable`-
// prefixed spelling for readability at its call sites. These are EXACT aliases
// of the canonical types above — one shape on the wire, two spellings of the
// same TypeScript type. Adding aliases (not a second definition) keeps the
// §3b LOCK NOTE intact: there is still a single response shape, mirrored once.

/** Alias of {@link SamplesResponse} for HK-3b imports. */
export type WearableSamplesResponse = SamplesResponse;
/** Alias of {@link SampleSeries} for HK-3b imports. */
export type WearableSampleSeries = SampleSeries;

/**
 * A typed failure from the samples/preferences client. HK-3b branches on
 * `err instanceof WearableSamplesError && err.status === 403` to distinguish an
 * IDOR-gated coach read from a transient transport failure, so this is a REAL
 * class (never an `as any`): the `status` is the HTTP status the backend
 * returned (or a synthetic one for a Zod drift), `kind` is a stable string
 * discriminant, and `cause` preserves the original error for structured
 * logging WITHOUT swallowing it (#36).
 */
export class WearableSamplesError extends Error {
  constructor(
    public readonly kind: string,
    public readonly status: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WearableSamplesError';
    // Restore the prototype chain so `instanceof` holds across the TS→ES5
    // class-extends-builtin transpile (HK-3b relies on the instanceof check).
    Object.setPrototypeOf(this, WearableSamplesError.prototype);
  }
}

/** Result of a preferred-source upsert (mirror of backend POST response). */
export const preferenceResultSchema = z.object({
  metric: metricSchema,
  preferred_provider: providerSchema,
  updated_at: z.string(),
});

export type PreferenceResult = z.infer<typeof preferenceResultSchema>;

// ─── Query params ─────────────────────────────────────────────────────────────

/**
 * Caller-facing params for {@link getSamples}. `from`/`to` are ISO-8601
 * datetime strings (the hooks compute them from a window selector); the
 * backend hard-caps `to - from <= 90 days` and 400s a longer window, so the
 * hooks must not request more.
 */
export interface GetSamplesParams {
  readonly bucket: WearableMetricBucket;
  readonly from: string;
  readonly to: string;
  readonly metric?: WearableMetricType;
  /** Coach-only: read a client's series. Service re-checks ownership → 403. */
  readonly clientId?: string;
  readonly granularity?: SampleGranularity;
  /**
   * When true (default), the backend resolves the single best provider per
   * metric via `resolveBest`. When false, ALL providers' samples for the
   * window are returned (Metric Detail "compare sources" view).
   */
  readonly preferredOnly?: boolean;
  /**
   * Optional explicit provider filter (HK-3b contract). When set, only these
   * providers' samples are requested. Sent as a comma-joined `providers` query
   * param. (Backend acceptance is being added in PR #356 — see deliverable
   * BACKEND_COORDINATION_REQUIRED.)
   */
  readonly providers?: readonly WearableProvider[];
  /**
   * Optional IANA timezone for server-side day-boundary bucketing (HK-3b
   * contract). Sent as a `timezone` query param.
   */
  readonly timezone?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

const SAMPLES_BASE = '/v1/wearables/samples';
const PREFERENCES_BASE = '/v1/wearables/preferences';

/**
 * Build the query object sent to the backend. Optional params are OMITTED
 * (not sent as `undefined`) so the backend's `.strict()` Zod schema — which
 * rejects unknown keys but tolerates absent optionals — never sees a stray
 * key. Booleans are stringified to `'true'`/`'false'` because the backend
 * parses query booleans from those exact literals (no implicit truthiness).
 */
function buildSamplesQuery(params: GetSamplesParams): Record<string, string> {
  const query: Record<string, string> = {
    bucket: params.bucket,
    from: params.from,
    to: params.to,
  };
  if (params.metric !== undefined) query.metric = params.metric;
  if (params.clientId !== undefined) query.clientId = params.clientId;
  if (params.granularity !== undefined) query.granularity = params.granularity;
  if (params.preferredOnly !== undefined) {
    query.preferredOnly = params.preferredOnly ? 'true' : 'false';
  }
  // Provider filter + timezone (HK-3b contract). Omitted (not sent as the
  // string "undefined") so the backend's tolerant-of-absent-optionals schema
  // never sees a stray key. An empty providers array is treated as "no filter"
  // and omitted too.
  if (params.providers !== undefined && params.providers.length > 0) {
    query.providers = [...params.providers].join(',');
  }
  if (params.timezone !== undefined) query.timezone = params.timezone;
  return query;
}

export const wearablesSamplesApi = {
  /**
   * Read wearable time-series for a bucket (and optional single metric) over a
   * window. The window is hard-capped at 90 days server-side.
   *
   * Transport failures (400/403/503) are RE-THROWN as a typed
   * {@link WearableSamplesError} carrying the HTTP `status`, so callers (and
   * HK-3b's `isForbidden` guard) can branch on `err.status === 403` without
   * depending on axios internals. A Zod drift propagates UNCHANGED as a
   * `ZodError` (it is a contract-shape bug, not an HTTP status). We never
   * swallow either (#36): a `WearableSamplesError` always preserves the
   * original error in `cause` for structured logging.
   * @throws ZodError if the wire shape drifts from the backend DTO.
   * @throws WearableSamplesError (with `.status`) on a transport failure.
   */
  async getSamples(params: GetSamplesParams): Promise<SamplesResponse> {
    try {
      const res = await api.get<unknown>(SAMPLES_BASE, {
        params: buildSamplesQuery(params),
      });
      return samplesResponseSchema.parse(res.data);
    } catch (err) {
      // A Zod drift is a shape contract bug, not an HTTP status — surface it
      // verbatim so the existing parse-throws contract is unchanged.
      if (err instanceof z.ZodError) throw err;
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? 0;
        const kind =
          status === 403
            ? 'forbidden'
            : status === 400
              ? 'bad_request'
              : status >= 500
                ? 'degraded'
                : 'transport';
        // Log with structured context (NO sample values / PII — #34) then
        // re-throw as a typed error. This is the "best-effort secondary call"
        // pattern inverted: the PRIMARY call's failure is never hidden.
        logger.log('wearablesSamplesApi', 'getSamples failed', {
          status,
          kind,
          bucket: params.bucket,
        });
        throw new WearableSamplesError(
          kind,
          status,
          err.message || `WEARABLE_SAMPLES_${kind.toUpperCase()}`,
          err,
        );
      }
      // Unknown non-axios, non-Zod error — never swallow; re-throw as-is.
      throw err;
    }
  },

  /**
   * Upsert the caller's preferred provider for a metric (idempotent on
   * (user_id, metric) server-side). The user always writes their OWN
   * preference — the owning user comes from the JWT, never the body, so there
   * is no IDOR surface (#5).
   * @throws ZodError on a drifted response.
   */
  async setPreference(
    metric: WearableMetricType,
    preferredProvider: WearableProvider,
  ): Promise<PreferenceResult> {
    const res = await api.post<unknown>(PREFERENCES_BASE, {
      metric,
      preferred_provider: preferredProvider,
    });
    return preferenceResultSchema.parse(res.data);
  },

  /**
   * Remove the caller's preferred-source override for a metric; subsequent
   * reads fall back to recency (`resolveBest`). The backend returns 204 No
   * Content, so there is no body to parse.
   * @throws AxiosError on 404 (no override existed) — surfaced so the caller
   *         never mistakes a no-op for a successful clear.
   */
  async clearPreference(metric: WearableMetricType): Promise<void> {
    await api.delete<void>(`${PREFERENCES_BASE}/${metric}`);
  },
};
