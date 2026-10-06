/**
 * workoutBuilderApi
 *
 * Typed client for the Sprint B v2 workout builder endpoints
 * (PR #188 backend). Coach surfaces under `/workout-plans/*`, client
 * surfaces under `/assignments/*`. All calls route through the
 * shared axios instance so auth + 401-refresh are handled.
 *
 * Backend contract source of truth:
 *   src/workout-builder/workout-builder.controller.ts (`@Controller('workout-plans')`)
 *   src/workout-builder/workout-builder.dto.ts
 * Mirror in this file is intentional: the mobile owns its visible
 * shape so backend-side Prisma row leakage does not pin the UI.
 */

import api from '../services/api';

// ─── Enums + DTOs (mirror backend) ───────────────────────────────────────────

export type WorkoutType = 'strength' | 'cardio' | 'mobility';

export interface CreateWorkoutPlanInput {
  name: string;
  type: WorkoutType;
  duration_estimate_minutes?: number;
}

export interface UpdateWorkoutPlanInput {
  name?: string;
  type?: WorkoutType;
  duration_estimate_minutes?: number;
}

export interface UpsertExerciseRowInput {
  /** ExerciseDB external catalog id (or `seed:` prefixed seed id). */
  exercise_external_id: string;
  /** 1-indexed order within the plan. Must be unique per plan. */
  order: number;
  sets: number;
  /** Rep count OR duration in seconds, by convention. */
  reps_or_duration_seconds: number;
  weight_lbs?: number;
  rest_seconds?: number;
  /** Exercises sharing a group id are performed back-to-back. */
  superset_group_id?: string;
  notes?: string;
}

export interface CreateAssignmentInput {
  client_id: string;
  /** ISO 8601 datetime. */
  scheduled_for: string;
}

export interface CompleteAssignmentInput {
  /** RPE 1-10. */
  post_rpe?: number;
  post_notes?: string;
  idempotency_key?: string;
  completion_payload?: Record<string, unknown>;
  started_at?: string;
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface WorkoutPlanExercise {
  id: string;
  workout_plan_id: string;
  exercise_external_id: string;
  order: number;
  sets: number;
  reps_or_duration_seconds: number;
  weight_lbs: number | null;
  rest_seconds: number | null;
  superset_group_id: string | null;
  notes: string | null;
}

export interface WorkoutPlan {
  id: string;
  coach_id: string;
  name: string;
  type: WorkoutType;
  duration_estimate_minutes: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  exercises: WorkoutPlanExercise[];
}

export interface ClientWorkoutAssignment {
  id: string;
  workout_plan_id: string;
  client_id: string;
  assigned_by_coach_id: string;
  scheduled_for: string;
  completed_at: string | null;
  post_rpe: number | null;
  post_notes: string | null;
}

export interface ClientWorkoutAssignmentWithPlan extends ClientWorkoutAssignment {
  workout_plan: WorkoutPlan;
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Pages of 50 read for GET /assignments/me (1,000 assignments). */
export const MY_ASSIGNMENTS_MAX_PAGES = 20;

export const workoutBuilderApi = {
  // ---- Coach surfaces ------------------------------------------------------
  listPlans: () => api.get<WorkoutPlan[]>('/workout-plans'),

  getPlan: (planId: string) =>
    api.get<WorkoutPlan>(`/workout-plans/${planId}`),

  createPlan: (input: CreateWorkoutPlanInput) =>
    api.post<WorkoutPlan>('/workout-plans', input),

  updatePlan: (planId: string, input: UpdateWorkoutPlanInput) =>
    api.patch<WorkoutPlan>(`/workout-plans/${planId}`, input),

  archivePlan: (planId: string) =>
    api.delete<WorkoutPlan>(`/workout-plans/${planId}`),

  // Replace the full exercise row list in one call.
  setExercises: (planId: string, rows: UpsertExerciseRowInput[]) =>
    api.put<WorkoutPlanExercise[]>(`/workout-plans/${planId}/exercises`, rows),

  assignPlan: (planId: string, input: CreateAssignmentInput) =>
    api.post<ClientWorkoutAssignment>(
      `/workout-plans/${planId}/assignments`,
      input,
    ),

  listAssignmentsForPlan: (planId: string) =>
    api.get<ClientWorkoutAssignment[]>(`/workout-plans/${planId}/assignments`),

  // ---- Client surfaces -----------------------------------------------------
  /**
   * Every assignment the signed-in client has, oldest first.
   *
   * AUDIT-07-125: GET /assignments/me answers one page,
   * `{ items, nextCursor }` (at most 50 rows, ordered by scheduled_for), not a
   * bare list. Reading the reply as a list left the Workouts tab with no
   * assigned workouts and broke the Your workouts list. Read every page; a bare
   * list is still accepted. A failed page fails the whole load so the list is
   * never shown as complete when it is not.
   */
  listMyAssignments: async (): Promise<ClientWorkoutAssignmentWithPlan[]> => {
    const out: ClientWorkoutAssignmentWithPlan[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MY_ASSIGNMENTS_MAX_PAGES; page += 1) {
      const res = await api.get<unknown>('/assignments/me', {
        params: cursor ? { cursor } : undefined,
      });
      const body: unknown = res.data;
      if (Array.isArray(body)) {
        return body as ClientWorkoutAssignmentWithPlan[];
      }
      const pageBody = (body ?? {}) as { items?: unknown; nextCursor?: unknown };
      if (!Array.isArray(pageBody.items)) {
        throw new Error('Your workouts could not be read. Pull to try again.');
      }
      out.push(...(pageBody.items as ClientWorkoutAssignmentWithPlan[]));
      const next = pageBody.nextCursor;
      if (typeof next !== 'string' || next === '' || next === cursor) break;
      cursor = next;
    }
    return out;
  },

  getMyAssignment: (assignmentId: string) =>
    api.get<ClientWorkoutAssignmentWithPlan>(`/assignments/${assignmentId}`),

  completeMyAssignment: (
    assignmentId: string,
    input: CompleteAssignmentInput,
  ) =>
    api.patch<ClientWorkoutAssignment>(
      `/assignments/${assignmentId}/complete`,
      input,
    ),
};
