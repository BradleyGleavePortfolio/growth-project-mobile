/**
 * coachDailyRingsApi — typed client for the ED.2 three-arc router daily-counts
 * backend.
 *
 * Backend contract source of truth (do not drift):
 *   growth-project-backend/src/coach/home/coach-home.controller.ts
 *   growth-project-backend/src/coach/home/coach-home.service.ts
 *
 * Wire posture:
 *   - GET /coach/home/daily-rings, coach/owner gated server-side.
 *   - The response is Zod-validated at the boundary; a drifted shape THROWS a
 *     `contract` error rather than silently mis-rendering the rings.
 *   - When the backend flag FEATURE_ROMAN_THREE_ARC_COUNTS is OFF the endpoint
 *     returns a fully-zeroed shape (all counts 0, brief.opened false) — the
 *     same shape this client parses, so an asymmetric rollout renders three
 *     empty rings gracefully with no error.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';

/** Network read carries an AbortSignal.timeout (mirrors community clients). */
export const DAILY_RINGS_REQUEST_TIMEOUT_MS = 15_000;

// ─── Response schema (mirrors backend DailyRingsResponse, camelCase wire) ────

export const DailyRingsSchema = z
  .object({
    checkIns: z
      .object({
        reviewed: z.number().int().nonnegative(),
        submitted: z.number().int().nonnegative(),
      })
      .strict(),
    brief: z.object({ opened: z.boolean() }).strict(),
    review: z
      .object({
        reviewed: z.number().int().nonnegative(),
        totalConversations: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type DailyRings = z.infer<typeof DailyRingsSchema>;

/** The zeroed shape — what the backend returns while its flag is OFF. */
export function zeroedDailyRings(): DailyRings {
  return {
    checkIns: { reviewed: 0, submitted: 0 },
    brief: { opened: false },
    review: { reviewed: 0, totalConversations: 0 },
  };
}

export type DailyRingsErrorKind = 'forbidden' | 'contract' | 'network';

export class DailyRingsApiError extends Error {
  constructor(
    readonly kind: DailyRingsErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'DailyRingsApiError';
  }
}

export const coachDailyRingsApi = {
  /**
   * GET /coach/home/daily-rings — today's three-arc completion counts for the
   * calling coach. Always scoped server-side to req.user.id.
   */
  async get(): Promise<DailyRings> {
    try {
      const res = await api.get('/coach/home/daily-rings', {
        signal: AbortSignal.timeout(DAILY_RINGS_REQUEST_TIMEOUT_MS),
      });
      const parsed = DailyRingsSchema.safeParse(res.data);
      if (!parsed.success) {
        throw new DailyRingsApiError(
          'contract',
          `daily-rings response shape drifted: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof DailyRingsApiError) throw err;
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        throw new DailyRingsApiError('forbidden', 'coach access required');
      }
      throw new DailyRingsApiError(
        'network',
        err instanceof Error ? err.message : 'daily-rings request failed',
      );
    }
  },
};
