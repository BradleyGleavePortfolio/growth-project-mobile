/**
 * Coach AI v1 — shared types
 *
 * Mirrors the backend contract defined by branch
 * `feat/coach-ai-engine-v1-backend` on `growth-project-backend`:
 *
 *   GET  /coach/ai/status
 *   POST /coach/ai/workout-program
 *   POST /coach/ai/meal-plan
 *   POST /coach/ai/client-insight
 *   GET  /coach/ai/drafts/:draftId
 *   POST /coach/ai/drafts/:draftId/approve
 *   POST /coach/ai/drafts/:draftId/edit
 *   POST /coach/ai/drafts/:draftId/reject
 *
 * Mobile owns its visible shape; the types here are the contract the
 * UI relies on. Backend response shapes are kept permissive — extra
 * fields are tolerated.
 */

export type CoachAiDraftType = 'WORKOUT_PROGRAM' | 'MEAL_PLAN' | 'INSIGHT';

// ─── Status ──────────────────────────────────────────────────────────────────

export interface CoachAiStatus {
  /** True only if the backend has a real provider key set in Fly secrets. */
  ready: boolean;
  /** Short human-readable reason when ready=false (e.g. "no_api_key"). */
  reason?: string;
  /** Resolved model id (e.g. "claude-opus-4-7"). Present even when ready=false. */
  modelUsed?: string;
}

// ─── Workout program payload ─────────────────────────────────────────────────

export interface AiWorkoutSet {
  reps?: number | null;
  /** Optional weight cue ("bodyweight", "RPE-controlled", "75% 1RM"). */
  weight?: string | number | null;
  /** Reps in reserve. */
  rir?: number | null;
  /** Rate of perceived exertion (0-10). */
  rpe?: number | null;
  rest_seconds?: number | null;
}

export interface AiWorkoutExercise {
  name: string;
  sets?: number | null;
  reps?: string | number | null;
  rir?: number | null;
  rpe?: number | null;
  notes?: string | null;
  /** Optional per-set breakdown when the model returns one. */
  set_detail?: AiWorkoutSet[];
}

export interface AiWorkoutDay {
  day: number;
  focus?: string | null;
  exercises: AiWorkoutExercise[];
}

export interface AiWorkoutWeek {
  week: number;
  notes?: string | null;
  days: AiWorkoutDay[];
}

export interface WorkoutPayload {
  title?: string | null;
  summary?: string | null;
  weeks: AiWorkoutWeek[];
}

// ─── Meal plan payload ───────────────────────────────────────────────────────

export interface AiMealItem {
  name: string;
  /** Free-form portion description ("1 cup", "150g"). */
  portion?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  notes?: string | null;
}

export interface AiMeal {
  /** breakfast / lunch / dinner / snack / etc — free text. */
  time_of_day?: string | null;
  name?: string | null;
  items: AiMealItem[];
}

export interface AiMealDay {
  day: number;
  notes?: string | null;
  /** Daily totals when the model returns them. */
  total_calories?: number | null;
  total_protein_g?: number | null;
  total_carbs_g?: number | null;
  total_fat_g?: number | null;
  meals: AiMeal[];
}

export interface MealPlanPayload {
  title?: string | null;
  summary?: string | null;
  days: AiMealDay[];
}

// ─── Insight payload ─────────────────────────────────────────────────────────

export interface InsightPayload {
  summary: string;
  wins: string[];
  concerns: string[];
  suggested_actions: string[];
  questions_for_coach: string[];
}

// ─── Draft envelope ──────────────────────────────────────────────────────────

export type GeneratedPayload = WorkoutPayload | MealPlanPayload | InsightPayload;

export interface Draft<T extends GeneratedPayload = GeneratedPayload> {
  draftId: string;
  type: CoachAiDraftType;
  clientId: string;
  generatedPayload: T;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  createdAt?: string;
  /** approved | rejected | pending — backend may add more states. */
  status?: string;
}

// ─── Request inputs (mirror backend DTOs) ────────────────────────────────────

export interface GenerateWorkoutInput {
  clientId: string;
  /** 1-12 inclusive. */
  weeks: number;
  /** 1-7 inclusive. */
  daysPerWeek: number;
  /** Optional focus tag: Strength / Hypertrophy / Endurance / Mobility. */
  focus?: string;
  notes?: string;
}

export interface GenerateMealPlanInput {
  clientId: string;
  /** 1-14 inclusive. */
  days: number;
  notes?: string;
  /**
   * B14: explicit safety fields. The backend already reads the client's
   * stored profile, but a missing-by-default field in a prompt is a silent
   * way to drop an allergy on the floor. We mirror these into the request
   * so:
   *   - the generator sees them in the API contract (not just from a DB
   *     side-channel),
   *   - the values are auditable on the wire (Sentry / server logs),
   *   - any field added on mobile is immediately usable without a backend
   *     deploy.
   */
  allergies?: string[];
  dietary_restrictions?: string[];
}

export interface GenerateInsightInput {
  clientId: string;
  /** Defaults to 7 server-side. */
  windowDays?: number;
}

// ─── Approve / edit / reject responses ───────────────────────────────────────

export interface ApproveResult {
  approvedAsId: string;
  approvedType: CoachAiDraftType;
}

export interface RejectInput {
  reason: string;
}

export interface EditInput<T extends GeneratedPayload = GeneratedPayload> {
  /** Partial patch — the backend merges over the existing generatedPayload. */
  patch: Partial<T>;
}

// ─── Error shape returned when AI is disabled (503) ──────────────────────────

export interface CoachAiDisabledError {
  error: 'ai_disabled';
  action: string;
}
