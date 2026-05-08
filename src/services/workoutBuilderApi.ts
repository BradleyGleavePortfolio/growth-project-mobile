/**
 * workoutBuilderApi — typed client for the backend workout plan builder
 * and client assignment endpoints.
 *
 * Endpoints covered:
 *   GET    /workout-plans                         list coach's plans
 *   POST   /workout-plans                         create plan
 *   GET    /workout-plans/:planId                 get single plan
 *   PATCH  /workout-plans/:planId                 update plan metadata
 *   DELETE /workout-plans/:planId                 archive plan
 *   PUT    /workout-plans/:planId/exercises       replace all exercise rows
 *   POST   /workout-plans/:planId/assignments     assign to a client
 *   GET    /workout-plans/:planId/assignments     list assignments
 *   PATCH  /assignments/:assignmentId/complete    client marks complete
 */

import api from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkoutType = 'strength' | 'cardio' | 'mobility';

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

export interface CreateWorkoutPlanPayload {
  name: string;
  type: WorkoutType;
  duration_estimate_minutes?: number;
}

export interface UpdateWorkoutPlanPayload {
  name?: string;
  type?: WorkoutType;
  duration_estimate_minutes?: number;
}

export interface ExerciseRowPayload {
  exercise_external_id: string;
  order: number;
  sets: number;
  reps_or_duration_seconds: number;
  weight_lbs?: number;
  rest_seconds?: number;
  superset_group_id?: string;
  notes?: string;
}

export interface CreateAssignmentPayload {
  client_id: string;
  scheduled_for: string;
}

export interface CompleteAssignmentPayload {
  post_rpe?: number;
  post_notes?: string;
}

// ─── Plan CRUD ────────────────────────────────────────────────────────────────

export async function listWorkoutPlans(): Promise<WorkoutPlan[]> {
  const { data } = await api.get<WorkoutPlan[]>('/workout-plans');
  return data;
}

export async function createWorkoutPlan(
  payload: CreateWorkoutPlanPayload,
): Promise<WorkoutPlan> {
  const { data } = await api.post<WorkoutPlan>('/workout-plans', payload);
  return data;
}

export async function getWorkoutPlan(planId: string): Promise<WorkoutPlan> {
  const { data } = await api.get<WorkoutPlan>(`/workout-plans/${planId}`);
  return data;
}

export async function updateWorkoutPlan(
  planId: string,
  payload: UpdateWorkoutPlanPayload,
): Promise<WorkoutPlan> {
  const { data } = await api.patch<WorkoutPlan>(`/workout-plans/${planId}`, payload);
  return data;
}

export async function archiveWorkoutPlan(planId: string): Promise<void> {
  await api.delete(`/workout-plans/${planId}`);
}

// ─── Exercise rows ────────────────────────────────────────────────────────────

export async function setExerciseRows(
  planId: string,
  rows: ExerciseRowPayload[],
): Promise<WorkoutPlanExercise[]> {
  const { data } = await api.put<WorkoutPlanExercise[]>(
    `/workout-plans/${planId}/exercises`,
    rows,
  );
  return data;
}

// ─── Assignments ──────────────────────────────────────────────────────────────

export async function assignWorkoutPlan(
  planId: string,
  payload: CreateAssignmentPayload,
): Promise<ClientWorkoutAssignment> {
  const { data } = await api.post<ClientWorkoutAssignment>(
    `/workout-plans/${planId}/assignments`,
    payload,
  );
  return data;
}

export async function listAssignments(
  planId: string,
): Promise<ClientWorkoutAssignment[]> {
  const { data } = await api.get<ClientWorkoutAssignment[]>(
    `/workout-plans/${planId}/assignments`,
  );
  return data;
}

export async function completeAssignment(
  assignmentId: string,
  payload: CompleteAssignmentPayload = {},
): Promise<ClientWorkoutAssignment> {
  const { data } = await api.patch<ClientWorkoutAssignment>(
    `/assignments/${assignmentId}/complete`,
    payload,
  );
  return data;
}
