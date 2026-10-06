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
  /**
   * Portion as the backend sends it ("6 oz", "1 cup"). This is the field the
   * approve step copies into the client's plan (meal-plan.prompt.ts).
   */
  serving?: string | null;
  /** Older mobile name for the portion; read only as a fallback. */
  portion?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  notes?: string | null;
}

export interface AiMeal {
  /** breakfast / lunch / dinner / snack — the backend field the client sees. */
  slot?: string | null;
  /** Older mobile name for the slot; read only as a fallback. */
  time_of_day?: string | null;
  name?: string | null;
  items: AiMealItem[];
}

export interface AiMealDayTotals {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

export interface AiMealDay {
  day: number;
  notes?: string | null;
  /** Daily totals as the backend sends them (meal-plan.prompt.ts). */
  daily_totals?: AiMealDayTotals | null;
  /** Older mobile names for the totals; read only as a fallback. */
  total_calories?: number | null;
  total_protein_g?: number | null;
  total_carbs_g?: number | null;
  total_fat_g?: number | null;
  meals: AiMeal[];
}

export interface MealPlanPayload {
  title?: string | null;
  summary?: string | null;
  /** Notes the approve step copies onto the plan the client sees. */
  coach_notes?: string | null;
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
  /**
   * B14: the client's allergies and dietary restrictions are mirrored into
   * `notes` by CoachAiSection. The backend body allow-list accepts only
   * clientId, days and notes; any other key is refused with a 400.
   */
  notes?: string;
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
  /** Workouts scheduled for the client by a backend that assigns AI program
   *  days on approval. Absent on the production backend (library save only). */
  assigned_count?: number;
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
