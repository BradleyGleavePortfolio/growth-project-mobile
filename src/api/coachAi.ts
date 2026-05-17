/**
 * coachAiApi — Coach AI v1 client
 *
 * Typed client for the eight endpoints under `/coach/ai/*` introduced by
 * the backend branch `feat/coach-ai-engine-v1-backend`. All calls route
 * through the shared axios instance so JWT attach + 401-refresh stay
 * uniform with the rest of the app.
 *
 * Endpoints:
 *   GET    /coach/ai/status                              status()
 *   POST   /coach/ai/workout-program                     generateWorkout()
 *   POST   /coach/ai/meal-plan                           generateMealPlan()
 *   POST   /coach/ai/client-insight                      generateInsight()
 *   GET    /coach/ai/drafts/:draftId                     getDraft()
 *   POST   /coach/ai/drafts/:draftId/approve             approveDraft()
 *   POST   /coach/ai/drafts/:draftId/edit                editDraft()
 *   POST   /coach/ai/drafts/:draftId/reject              rejectDraft()
 *
 * When the backend has no `ANTHROPIC_API_KEY` set in Fly secrets the
 * generate routes return HTTP 503 with body
 *   { error: 'ai_disabled', action: 'set ANTHROPIC_API_KEY in Fly secrets' }
 * The mobile uses `status()` to hide the generate CTAs proactively, but
 * any caller of the generate routes must still be prepared to handle a
 * 503 — see `isAiDisabledError`.
 */

import { AxiosError } from 'axios';
import api from '../services/api';
import type {
  ApproveResult,
  CoachAiDisabledError,
  CoachAiDraftType,
  CoachAiStatus,
  Draft,
  EditInput,
  GenerateInsightInput,
  GenerateMealPlanInput,
  GenerateWorkoutInput,
  GeneratedPayload,
  InsightPayload,
  MealPlanPayload,
  RejectInput,
  WorkoutPayload,
} from '../types/coachAi';

// ─── listDrafts response shape ────────────────────────────────────────────────
// Matches the backend's SELECT projection in CoachAIService.listDrafts().
// Only summary fields are returned (no generatedPayload) so the inbox list
// stays lightweight. Navigate to the per-type draft screen to load the full
// payload when the coach taps a row.
export interface PendingDraftSummary {
  id: string;
  type: CoachAiDraftType;
  clientId: string;
  status: string;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  createdAt: string;
}

// C-1: a 4-week workout / 7-day meal plan generation typically takes
// 25–60 s on Anthropic + a Fly cold start. The shared axios client
// defaults to 30 s, so the mobile aborts on the slow path; the backend
// completes regardless and persists an orphan draft the coach has no
// way to recover (no `listDrafts` surface). Bump the per-call timeout
// for the three generate endpoints only — the rest of the AI surface
// (status, get/edit/approve/reject) stays on the global 30 s.
const AI_GENERATE_TIMEOUT_MS = 120_000;

export const coachAiApi = {
  /**
   * Probe whether the AI engine is wired. Mobile calls this on
   * ClientDetailScreen mount and hides the generate CTAs when
   * `ready === false`.
   */
  status: () => api.get<CoachAiStatus>('/coach/ai/status'),

  /** Generate a workout program draft for a client. */
  generateWorkout: (input: GenerateWorkoutInput) =>
    api.post<Draft<WorkoutPayload>>('/coach/ai/workout-program', input, {
      timeout: AI_GENERATE_TIMEOUT_MS,
    }),

  /** Generate a meal plan draft for a client. */
  generateMealPlan: (input: GenerateMealPlanInput) =>
    api.post<Draft<MealPlanPayload>>('/coach/ai/meal-plan', input, {
      timeout: AI_GENERATE_TIMEOUT_MS,
    }),

  /** Generate a weekly insight digest for a client. */
  generateInsight: (input: GenerateInsightInput) =>
    api.post<Draft<InsightPayload>>('/coach/ai/client-insight', input, {
      timeout: AI_GENERATE_TIMEOUT_MS,
    }),

  /** Load a draft by id. */
  getDraft: <T extends GeneratedPayload = GeneratedPayload>(draftId: string) =>
    api.get<Draft<T>>(`/coach/ai/drafts/${encodeURIComponent(draftId)}`),

  /**
   * Approve a draft. Backend materializes the appropriate row
   * (WorkoutPlan / MealPlan / coach note) and returns the new id.
   */
  approveDraft: (draftId: string) =>
    api.post<ApproveResult>(
      `/coach/ai/drafts/${encodeURIComponent(draftId)}/approve`,
    ),

  /**
   * Save coach edits. Body is `{ patch: Partial<GeneratedPayload> }` —
   * backend merges over the existing payload.
   */
  editDraft: <T extends GeneratedPayload = GeneratedPayload>(
    draftId: string,
    patch: Partial<T>,
  ) =>
    api.post<Draft<T>>(
      `/coach/ai/drafts/${encodeURIComponent(draftId)}/edit`,
      { patch } satisfies EditInput<T>,
    ),

  /** Reject a draft with a free-text reason. */
  rejectDraft: (draftId: string, reason: string) =>
    api.post<{ rejected: true }>(
      `/coach/ai/drafts/${encodeURIComponent(draftId)}/reject`,
      { reason } satisfies RejectInput,
    ),

  /**
   * List pending (status=DRAFT) AI drafts for this coach.
   *
   * Used by the "Pending AI drafts" inbox and the post-timeout background
   * poll. Pass `clientId` to narrow results to a single client so the poll
   * only surfaces a draft for the client the coach was actively generating
   * content for when the 120-second timeout fired.
   */
  listDrafts: (opts: { clientId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.clientId) params.set('clientId', opts.clientId);
    if (opts.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return api.get<PendingDraftSummary[]>(
      `/coach/ai/drafts${qs ? `?${qs}` : ''}`,
    );
  },
};

/**
 * Type guard: was this error a 503 ai_disabled response? Use to render
 * a friendly fallback if a generate call sneaks past the status gate.
 */
export function isAiDisabledError(err: unknown): err is AxiosError<CoachAiDisabledError> {
  if (!err || typeof err !== 'object') return false;
  const ax = err as AxiosError<CoachAiDisabledError>;
  if (ax.response?.status !== 503) return false;
  const body = ax.response?.data;
  return !!body && typeof body === 'object' && body.error === 'ai_disabled';
}

/**
 * Type guard: was this error caused by the 120-second axios timeout?
 *
 * Axios sets `code = 'ECONNABORTED'` and `message` containing 'timeout'
 * when the request duration exceeds the configured `timeout` option.
 * This is distinct from a network connectivity failure (no `response`).
 *
 * Use this to show the "Still generating — check your drafts inbox"
 * message instead of a generic error banner.
 */
export function isTimeoutError(err: unknown): err is AxiosError {
  if (!err || typeof err !== 'object') return false;
  const ax = err as AxiosError;
  return ax.code === 'ECONNABORTED' || (typeof ax.message === 'string' && ax.message.toLowerCase().includes('timeout'));
}

export default coachAiApi;
