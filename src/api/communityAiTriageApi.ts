/**
 * communityAiTriageApi — HTTP client + Zod contracts for the v2-4 community AI
 * inbox-triage surface. The wire contract lives here in exactly one place
 * (single source of truth) and is mirrored EXACTLY from the backend, with no
 * drift.
 *
 * Backend contract source of truth (mirrored field-for-field):
 *   growth-project-backend/src/community/ai-triage/triage-output.schema.ts
 *     - TRIAGE_CATEGORIES                  (schema.ts:26-32) — the five
 *       categories, in priority order; mirrored by TRIAGE_CATEGORIES below.
 *     - TriageItemSchema (.strict())       (schema.ts:48-55) — source_item_id
 *       (uuid), source_kind, category, summary (1..280).
 *     - TriageBucketSchema (.strict())     (schema.ts:61-66) — category + items.
 *     - TriageResponseSchema (.strict())   (schema.ts:85-92) — generated_at
 *       (datetime), is_empty (bool), buckets (length 5), source_item_ids
 *       (uuid[]).
 *   growth-project-backend/src/community/ai-triage/ai-triage.controller.ts
 *     - GET /community/ai-triage           (controller.ts:43-64) — coach/owner
 *       auth; response validated server-side with TriageResponseSchema.parse().
 *   growth-project-backend/src/community/ai-triage/triage-output.schema.ts
 *     - TRIAGE_SOURCE_KINDS = ['message','post'] (schema.ts:40).
 *
 * Every wire response is `.parse()`-validated against the locked contract here.
 * A future backend drift (a renamed field, a sixth category, a missing bucket)
 * trips the parse at the boundary instead of feeding a malformed shape into
 * React state. The card never autonomously sends anything — this client only
 * READS the triage; there is no write/approve method by design (backend has no
 * write path either).
 */

import { z } from 'zod';
import api from '../services/api';

// The five triage categories, in priority order. Mirrors backend
// triage-output.schema.ts:26-32 (TRIAGE_CATEGORIES). There is intentionally no
// sixth category; an unknown value fails the enum at the boundary.
export const TRIAGE_CATEGORIES = [
  'urgent',
  'win_to_celebrate',
  'form_check',
  'general',
  'no_action_needed',
] as const;
export const TriageCategorySchema = z.enum(TRIAGE_CATEGORIES);
export type TriageCategory = z.infer<typeof TriageCategorySchema>;

// Mirrors backend triage-output.schema.ts:40 (TRIAGE_SOURCE_KINDS).
export const TRIAGE_SOURCE_KINDS = ['message', 'post'] as const;
export const TriageSourceKindSchema = z.enum(TRIAGE_SOURCE_KINDS);
export type TriageSourceKind = z.infer<typeof TriageSourceKindSchema>;

// Mirrors backend TriageItemSchema (triage-output.schema.ts:48-55), .strict().
export const TriageItemSchema = z
  .object({
    source_item_id: z.string().uuid(),
    source_kind: TriageSourceKindSchema,
    category: TriageCategorySchema,
    summary: z.string().min(1).max(280),
  })
  .strict();
export type TriageItem = z.infer<typeof TriageItemSchema>;

// Mirrors backend TriageBucketSchema (triage-output.schema.ts:61-66), .strict().
export const TriageBucketSchema = z
  .object({
    category: TriageCategorySchema,
    items: z.array(TriageItemSchema),
  })
  .strict();
export type TriageBucket = z.infer<typeof TriageBucketSchema>;

// Mirrors backend TriageResponseSchema (triage-output.schema.ts:85-92),
// .strict(). buckets is always length-5 (one per category, server-built in
// canonical order); source_item_ids is the flat de-duped provenance list.
export const TriageResponseSchema = z
  .object({
    generated_at: z.string().datetime(),
    is_empty: z.boolean(),
    buckets: z.array(TriageBucketSchema).length(TRIAGE_CATEGORIES.length),
    source_item_ids: z.array(z.string().uuid()),
  })
  .strict();
export type TriageResponse = z.infer<typeof TriageResponseSchema>;

/**
 * Fetch the requesting coach's inbox triage.
 *
 * GET /community/ai-triage (backend ai-triage.controller.ts:43-64).
 *
 * No try/catch: the backend kill switch answers a byte-identical 404 when the
 * server flag is off, and any HTTP failure (4xx/5xx, network) or a Zod drift
 * propagates to the caller's error state so the card can render a calm, typed
 * error — never a silent failure and never a fabricated "all clear".
 */
export async function fetchInboxTriage(): Promise<TriageResponse> {
  const res = await api.get<unknown>('/community/ai-triage');
  return TriageResponseSchema.parse(res.data);
}

/**
 * Versioned segment in the triage query key. Bump when the cached triage shape
 * changes so stale entries from a prior shape are abandoned rather than
 * deserialized into the new contract.
 */
export const TRIAGE_KEY_VERSION = 'v1' as const;

/** Stable React Query key root for the coach inbox triage. */
export const triageQueryKeys = {
  inbox: () => ['community-ai-triage', TRIAGE_KEY_VERSION, 'inbox'] as const,
};
