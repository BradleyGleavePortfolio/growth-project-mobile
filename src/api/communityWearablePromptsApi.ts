/**
 * communityWearablePromptsApi — typed client for the v3-4 Community Wearable
 * Prompts backend (COACH-ONLY AI-generated coaching prompts sourced from a
 * client's already-opted-in wearable insights).
 *
 * Backend contract source of truth (do not drift):
 *   growth-project-backend/src/community/wearable-prompts/wearable-prompts.controller.ts
 *   growth-project-backend/src/community/wearable-prompts/wearable-prompts.dto.ts
 *
 * Wire posture mirrors communitySearchApi.ts (CAMELCASE wire shape):
 *   - Every response is Zod-validated at the boundary (a drifted shape THROWS
 *     as a `contract` error).
 *   - This is a COACH-ONLY surface: every route is coach/owner gated server-side
 *     (a client receives 403 → `forbidden`). The screen that consumes it is
 *     itself flag- + role-gated.
 *   - A prompt carries the human-readable coaching text plus a coach-only
 *     source-audit (which real WearableSample drove it). No raw health value is
 *     ever surfaced to a client.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { CommunityApiError } from './communityApi';

/** Every network read carries an AbortSignal.timeout. */
export const WEARABLE_PROMPTS_REQUEST_TIMEOUT_MS = 15_000;
/** Defensive page size for the prompt list read (bounded). */
export const WEARABLE_PROMPTS_PAGE_LIMIT = 50;

/**
 * The curated metric keys v3-4 generates prompts from (mirror backend
 * PROMPT_METRIC_ALLOWLIST). Kept as a string allowlist so the picker can offer
 * exactly these and a drifted value is rejected at the boundary.
 */
export const PROMPT_METRIC_KEYS = [
  'HRV_MS',
  'RECOVERY_SCORE',
  'READINESS_SCORE',
  'SLEEP_EFFICIENCY_PCT',
  'SLEEP_TOTAL_MIN',
  'RESTING_HEART_RATE_BPM',
] as const;
export type PromptMetricKey = (typeof PROMPT_METRIC_KEYS)[number];

/** Bounded skip reasons (mirror backend GenerateResponseSchema). */
export const PROMPT_SKIP_REASONS = [
  'cooldown',
  'no_consent',
  'degraded_connector',
  'no_data',
  'no_signal',
] as const;
export type PromptSkipReason = (typeof PROMPT_SKIP_REASONS)[number];

// ─── Response schemas (mirror backend Zod, CAMELCASE wire shape) ─────────────

export const PromptSourceViewSchema = z
  .object({
    sampleId: z.string(),
    metricKey: z.string(),
    observedValue: z.number(),
  })
  .strict();
export type PromptSourceView = z.infer<typeof PromptSourceViewSchema>;

export const PromptViewSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    coachId: z.string(),
    clientId: z.string(),
    metricKey: z.string(),
    promptText: z.string(),
    sources: z.array(PromptSourceViewSchema),
    generatedAt: z.string(),
    dismissedAt: z.string().nullable(),
    actedOnAt: z.string().nullable(),
  })
  .strict();
export type PromptView = z.infer<typeof PromptViewSchema>;

export const PromptListResponseSchema = z
  .object({
    version: z.literal(1),
    prompts: z.array(PromptViewSchema),
  })
  .strict();
export type PromptListResponse = z.infer<typeof PromptListResponseSchema>;

export const GenerateResponseSchema = z
  .object({
    version: z.literal(1),
    generated: z.array(PromptViewSchema),
    skipped: z.array(
      z
        .object({
          metricKey: z.string(),
          reason: z.enum(PROMPT_SKIP_REASONS),
        })
        .strict(),
    ),
  })
  .strict();
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

// ─── Transport helper (mirrors communitySearchApi.call) ──────────────────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  // The backend returns 404 for a prompt that is not the coach's (or absent);
  // the bounded CommunityApiError union has no 'not_found', so this maps to
  // 'gone' (the resource is not available to this caller) — the screen renders
  // a benign 'no longer available' state rather than a hard error.
  if (status === 404) return 'gone';
  if (status === 409) return 'conflict';
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
        `wearable-prompts request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'wearable-prompts request failed',
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
        'wearable-prompts response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

// ─── Request payloads (mirror backend DTOs) ──────────────────────────────────

export interface GeneratePromptsInput {
  /** The coach's client to generate prompts for. */
  clientId: string;
  /** Optional: restrict generation to a single metric. */
  metricKey?: PromptMetricKey;
}

export interface ListPromptsParams {
  clientId?: string;
  includeDismissed?: boolean;
  limit?: number;
}

function listQueryParams(opts: ListPromptsParams): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts.clientId) params.clientId = opts.clientId;
  if (opts.includeDismissed) params.includeDismissed = 'true';
  const limit = opts.limit ?? WEARABLE_PROMPTS_PAGE_LIMIT;
  if (Number.isFinite(limit) && limit > 0) params.limit = String(limit);
  return params;
}

// ─── API (COACH-ONLY) ────────────────────────────────────────────────────────

export const communityWearablePromptsApi = {
  /** Coach-initiated generation across (optionally one of) the allowlisted metrics. */
  async generate(
    workspaceId: string,
    input: GeneratePromptsInput,
  ): Promise<GenerateResponse> {
    return call(GenerateResponseSchema, () =>
      api.post(
        `/community/workspaces/${workspaceId}/wearable-prompts/generate`,
        input,
        { timeout: WEARABLE_PROMPTS_REQUEST_TIMEOUT_MS },
      ),
    );
  },

  /** List a coach's active (non-dismissed by default) prompts in a workspace. */
  async list(
    workspaceId: string,
    opts: ListPromptsParams = {},
  ): Promise<PromptListResponse> {
    return call(PromptListResponseSchema, () =>
      api.get(`/community/workspaces/${workspaceId}/wearable-prompts`, {
        params: listQueryParams(opts),
        timeout: WEARABLE_PROMPTS_REQUEST_TIMEOUT_MS,
      }),
    );
  },

  /** Dismiss a prompt (idempotent server-side). */
  async dismiss(workspaceId: string, promptId: string): Promise<PromptView> {
    return call(PromptViewSchema, () =>
      api.post(
        `/community/workspaces/${workspaceId}/wearable-prompts/${promptId}/dismiss`,
        {},
        { timeout: WEARABLE_PROMPTS_REQUEST_TIMEOUT_MS },
      ),
    );
  },

  /** Mark a prompt as acted-on (idempotent server-side). */
  async actOn(workspaceId: string, promptId: string): Promise<PromptView> {
    return call(PromptViewSchema, () =>
      api.post(
        `/community/workspaces/${workspaceId}/wearable-prompts/${promptId}/act-on`,
        {},
        { timeout: WEARABLE_PROMPTS_REQUEST_TIMEOUT_MS },
      ),
    );
  },
};
