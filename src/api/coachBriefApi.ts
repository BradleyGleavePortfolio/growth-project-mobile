/**
 * coachBriefApi — typed client for the daily Coach Brief.
 *
 * Backend contract source of truth (do not drift):
 *   growth-project-backend/src/coach/brief/coach-brief.controller.ts
 *   growth-project-backend/src/coach/brief/coach-brief.types.ts
 *
 *   GET  /coach/brief/today       today's brief; the first call of the day
 *                                 prepares it (can take up to ~30 s), a
 *                                 concurrent call sees status 'generating'.
 *   POST /coach/brief/regenerate  prepares it again (server-throttled, 3/hour).
 *   POST /coach/brief/:id/read    marks it read (feeds the Home brief ring).
 *
 * The response is Zod-validated at the boundary; a drifted shape throws a
 * `contract` error rather than rendering a half-empty brief.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';

/** Preparing a brief runs up to two model calls of 15 s each server-side. */
export const COACH_BRIEF_REQUEST_TIMEOUT_MS = 40_000;

const ActionItemSchema = z
  .object({
    type: z.string(),
    // Solo / sub-coach items name a client; head-coach items never do.
    client_id: z.string().optional(),
    client_name: z.string().optional(),
    detail: z.string(),
    priority: z.number(),
    deep_link: z.string().optional(),
  })
  .passthrough();

const SummarySchema = z
  .object({
    date: z.string(),
    brief_mode: z.enum(['solo_coach', 'head_coach', 'sub_coach']),
    narrative: z.string(),
    action_items: z.array(ActionItemSchema),
    generated_by: z.enum(['ai', 'fallback']),
  })
  .passthrough();

export const CoachBriefSchema = z
  .object({
    id: z.string(),
    brief_date: z.string(),
    status: z.enum(['pending', 'generating', 'generated', 'failed']),
    summary: SummarySchema.nullable(),
  })
  .passthrough();

export type CoachBrief = z.infer<typeof CoachBriefSchema>;
export type CoachBriefActionItem = z.infer<typeof ActionItemSchema>;

export type CoachBriefErrorKind = 'network' | 'contract' | 'throttled';

export class CoachBriefApiError extends Error {
  constructor(
    readonly kind: CoachBriefErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CoachBriefApiError';
  }
}

async function readBrief(request: () => Promise<{ data: unknown }>): Promise<CoachBrief> {
  try {
    const res = await request();
    const parsed = CoachBriefSchema.safeParse(res.data);
    if (!parsed.success) {
      throw new CoachBriefApiError(
        'contract',
        `coach brief response shape drifted: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  } catch (err) {
    if (err instanceof CoachBriefApiError) throw err;
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      throw new CoachBriefApiError('throttled', 'coach brief regenerate limit reached');
    }
    throw new CoachBriefApiError(
      'network',
      err instanceof Error ? err.message : 'coach brief request failed',
    );
  }
}

export const coachBriefApi = {
  today(): Promise<CoachBrief> {
    return readBrief(() =>
      api.get('/coach/brief/today', {
        signal: AbortSignal.timeout(COACH_BRIEF_REQUEST_TIMEOUT_MS),
      }),
    );
  },
  regenerate(): Promise<CoachBrief> {
    return readBrief(() =>
      api.post('/coach/brief/regenerate', undefined, {
        signal: AbortSignal.timeout(COACH_BRIEF_REQUEST_TIMEOUT_MS),
      }),
    );
  },
  async markRead(id: string): Promise<void> {
    await api.post(`/coach/brief/${encodeURIComponent(id)}/read`);
  },
};
