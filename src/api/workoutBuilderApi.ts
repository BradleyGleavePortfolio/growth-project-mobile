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
  listMyAssignments: () =>
    api.get<ClientWorkoutAssignmentWithPlan[]>('/assignments/me'),

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
