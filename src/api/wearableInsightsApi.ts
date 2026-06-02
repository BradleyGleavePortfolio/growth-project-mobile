/**
 * wearableInsightsApi — HTTP client + Zod contracts for the dual-role AI
 * insight surface (PR-HK-5a). This module is the SHARED client: the coach
 * panel (HK-5a) and the client panel (HK-5b) both import from here, so the
 * wire contract lives in exactly one place (single source of truth, #40).
 *
 * Backend contract source of truth (mirrored EXACTLY, no drift):
 *   growth-project-backend/src/wearables/insights/wearable-insights.controller.ts
 *   growth-project-backend/src/wearables/insights/insight-output.schema.ts
 *
 *   GET  /v1/wearables/insights/coach?clientId=<uuid>&bucket=<bucket>  (coach-auth)
 *   GET  /v1/wearables/insights/client?bucket=<bucket>                  (user-auth)
 *
 * Every wire response is `.parse()`-validated against the locked union
 * (full insight OR the strict empty state). A future backend drift trips the
 * parse here instead of feeding malformed data into React state (#8 phantom
 * validation, #17 fake coverage).
 *
 * DEVIATIONS from the builder brief's template (documented per directive):
 *   1. The brief imported `{ api }` (named). The repo's axios instance is a
 *      DEFAULT export (`src/services/api.ts:301`), so we import it as default.
 *   2. The brief used `z.nativeEnum(WearableMetricType)`. In the mobile repo
 *      `WearableMetricType` is a string-literal UNION TYPE derived from the
 *      `WEARABLE_METRIC_TYPES` const array — NOT a runtime enum object — so
 *      `z.nativeEnum` cannot consume it. We mirror the established pattern in
 *      `wearablesSamplesApi.ts:126` and use `z.enum(WEARABLE_METRIC_TYPES)`,
 *      which yields the identical value-set validation.
 *   3. The approve endpoint (POST /v1/wearables/insights/approve) does NOT
 *      exist yet — HK-6 lands it. Per the brief, a 404 is coerced into a typed
 *      `not_implemented` response so the panel degrades gracefully (honest,
 *      recoverable copy + retry), never a silent failure (#36) and never a
 *      spinner-only dead end.
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { logger } from '../utils/logger';
// WearableMetricType / WearableMetricBucket + their runtime arrays come from
// wearablesSamplesApi — IMPORT them; do NOT redeclare (single source of truth).
import {
  WEARABLE_METRIC_TYPES,
  type WearableMetricType,
  type WearableMetricBucket,
} from './wearablesSamplesApi';

// ── Confidence calibration ──────────────────────────────────────────────────
// Keep in sync with backend insight-output.schema.ts CONFIDENCE_LEVELS. If the
// backend adds a label, tsc fails-loud on the next pull (the Record maps below
// are exhaustive over the union).
export const CONFIDENCE_LEVELS = [
  'i_think',
  'fairly_sure',
  'confident',
  'certain',
  'verified',
] as const;
export const ConfidenceLevelSchema = z.enum(CONFIDENCE_LEVELS);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

/** Confidence label → display percentage (UX plan §6.3). */
export const CONFIDENCE_PCT: Record<ConfidenceLevel, number> = {
  i_think: 50,
  fairly_sure: 70,
  confident: 85,
  certain: 95,
  verified: 100,
};

/** Confidence label → human-readable label (UX plan §6.3). */
export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  i_think: 'I think',
  fairly_sure: 'Fairly sure',
  confident: 'Confident',
  certain: 'Certain',
  verified: 'Verified',
};

// Source-metric validation mirrors the backend `SourceMetricSchema`
// (`z.nativeEnum(WearableMetricType)` server-side, `z.enum` over the shared
// const array client-side — same value set, see deviation #2).
const SourceMetricSchema = z.enum(WEARABLE_METRIC_TYPES);

// ── Coach payload — mirrors backend CoachInsightSchema EXACTLY (.strict()) ──
export const CoachInsightSchema = z
  .object({
    observation: z.string().min(1).max(280),
    hypothesis: z.string().min(1).max(280),
    suggested_action: z.string().min(1).max(280),
    suggested_message_draft: z.string().min(1).max(1000),
    confidence_level: ConfidenceLevelSchema,
    source_metrics: z.array(SourceMetricSchema).min(1),
  })
  .strict();
export type CoachInsight = z.infer<typeof CoachInsightSchema>;

// ── Empty branch — mirrors backend EmptyInsightSchema ──
export const EMPTY_OBSERVATION = 'Not enough data yet — keep syncing.';
export const EmptyInsightSchema = z
  .object({
    observation: z.literal(EMPTY_OBSERVATION),
    confidence_level: z.literal('i_think'),
    source_metrics: z.array(SourceMetricSchema).length(0),
    is_empty: z.literal(true),
  })
  .strict();
export type EmptyInsight = z.infer<typeof EmptyInsightSchema>;

// ── Client payload — shipped here for HK-5b to import (HK-5b owns the consumer
// UI; HK-5a owns the shared type def + endpoint). Mirrors backend
// ClientInsightSchema EXACTLY (.strict()). ──
export const ClientInsightSchema = z
  .object({
    observation: z.string().min(1).max(280),
    norm_comparison: z.string().min(1).max(280),
    intervention: z.string().min(1).max(280),
    optional_cta: z
      .object({
        label: z.string().min(1).max(40),
        deep_link: z.string().regex(/^tgp:\/\//),
      })
      .nullable(),
    confidence_level: ConfidenceLevelSchema,
    source_metrics: z.array(SourceMetricSchema).min(1),
  })
  .strict();
export type ClientInsight = z.infer<typeof ClientInsightSchema>;

export const CoachInsightResponseSchema = z.union([
  CoachInsightSchema,
  EmptyInsightSchema,
]);
export type CoachInsightResponse = z.infer<typeof CoachInsightResponseSchema>;

export const ClientInsightResponseSchema = z.union([
  ClientInsightSchema,
  EmptyInsightSchema,
]);
export type ClientInsightResponse = z.infer<typeof ClientInsightResponseSchema>;

/**
 * Type guard so callers branch on the empty state without reaching for the
 * `is_empty` literal directly. Mirrors backend `isEmptyInsight`.
 */
export function isEmptyInsight(
  value: CoachInsightResponse | ClientInsightResponse,
): value is EmptyInsight {
  return (value as Partial<EmptyInsight>).is_empty === true;
}

// ── Approve payload — speculative; HK-6 lands the real controller. ──
// Success → { status: 'ok', draft_id, materialised_at }. Pre-HK-6 a 404 is
// coerced to { status: 'not_implemented', message } by `approveDraft` so the
// panel degrades to a calm, recoverable CTA (never a silent failure, #36/#50).
export const ApproveResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    draft_id: z.string().uuid(),
    materialised_at: z.string(),
  }),
  z.object({
    status: z.literal('not_implemented'),
    message: z.string(),
  }),
]);
export type ApproveResponse = z.infer<typeof ApproveResponseSchema>;

/** The honest, user-facing copy shown when the approval endpoint is pre-HK-6. */
export const APPROVAL_PENDING_MESSAGE =
  'Approval is rolling out — try again later.';

export interface ApproveDraftPayload {
  clientId: string;
  bucket: WearableMetricBucket;
  /** May differ from `suggested_message_draft` when the coach edited the text. */
  draftBody: string;
  action: 'approve' | 'edit' | 'dismiss';
}

export async function fetchCoachInsight(params: {
  clientId: string;
  bucket: WearableMetricBucket;
}): Promise<CoachInsightResponse> {
  const res = await api.get<unknown>('/v1/wearables/insights/coach', {
    params: { clientId: params.clientId, bucket: params.bucket },
  });
  return CoachInsightResponseSchema.parse(res.data);
}

export async function fetchClientInsight(params: {
  bucket: WearableMetricBucket;
}): Promise<ClientInsightResponse> {
  const res = await api.get<unknown>('/v1/wearables/insights/client', {
    params: { bucket: params.bucket },
  });
  return ClientInsightResponseSchema.parse(res.data);
}

export async function approveDraft(
  payload: ApproveDraftPayload,
): Promise<ApproveResponse> {
  try {
    const res = await api.post<unknown>('/v1/wearables/insights/approve', {
      client_id: payload.clientId,
      bucket: payload.bucket,
      draft_body: payload.draftBody,
      action: payload.action,
    });
    return ApproveResponseSchema.parse(res.data);
  } catch (err) {
    // A Zod drift is a shape-contract bug, not an HTTP status — surface it
    // verbatim (the panel renders it as a generic error, never raw internals).
    if (err instanceof z.ZodError) throw err;
    // Coerce ONLY the expected pre-HK-6 404 into a typed not_implemented
    // response. The calling hook surfaces this to the coach as a calm,
    // recoverable CTA — NOT a silent failure (#36), NOT a spinner.
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      // No client identifiers logged (#12/#34) — only the structural fact.
      logger.log('wearableInsightsApi', 'approve endpoint not yet live (404)', {
        bucket: payload.bucket,
        action: payload.action,
      });
      return { status: 'not_implemented', message: APPROVAL_PENDING_MESSAGE };
    }
    // Every other failure propagates — never swallowed.
    throw err;
  }
}

/**
 * Versioned segment in every insight query key. Bump this when the cached
 * insight shape changes so stale entries from a prior shape are abandoned
 * rather than deserialized into the new contract.
 */
export const INSIGHT_KEY_VERSION = 'v1' as const;

/** Stable React Query key roots so HK-5a + HK-5b never collide. */
export const insightQueryKeys = {
  coach: (clientId: string, bucket: WearableMetricBucket) =>
    ['wearable-insight', INSIGHT_KEY_VERSION, 'coach', clientId, bucket] as const,
  client: (bucket: WearableMetricBucket) =>
    ['wearable-insight', INSIGHT_KEY_VERSION, 'client', bucket] as const,
};

export type { WearableMetricType, WearableMetricBucket };
