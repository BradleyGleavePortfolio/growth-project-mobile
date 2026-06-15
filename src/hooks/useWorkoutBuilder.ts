/**
 * useWorkoutBuilder — React Query hooks over workoutBuilderApi.
 *
 * Coach surfaces: list/create/update/archive plans, set exercises,
 * assign plans to clients.
 * Client surfaces: list my assignments, mark complete.
 *
 * Query key convention (matches src/hooks/useApi.ts):
 *   ['workout-plans']                       — coach plan list
 *   ['workout-plans', planId]               — single plan
 *   ['workout-plans', planId, 'assignments']— assignments for a plan
 *   ['assignments', 'me']                   — client's own assignments
 *   ['assignments', assignmentId]           — single assignment
 *
 * Stale times: 5 min default for read endpoints, matching the backend
 * cache headroom.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  workoutBuilderApi,
  type ClientWorkoutAssignment,
  type ClientWorkoutAssignmentWithPlan,
  type CompleteAssignmentInput,
  type CreateAssignmentInput,
  type CreateWorkoutPlanInput,
  type UpdateWorkoutPlanInput,
  type UpsertExerciseRowInput,
  type WorkoutPlan,
  type WorkoutPlanExercise,
} from '../api/workoutBuilderApi';
import type {
  BuilderAction,
  CommandPlanPatch,
  CommandRowSnapshot,
} from './useBuilderCommandStack';

const FIVE_MIN_MS = 5 * 60 * 1000;

// ─── EW2 undo: inverse-op metadata builders ────────────────────────────────
//
// The undo command stack (useBuilderCommandStack) snapshots AT GESTURE TIME the
// data each forward op needs to be reversed. The builder's row mutations live in
// the screen's local state (added/removed/edited/reordered rows that flow to the
// server through the existing autosave + workoutBuilderAutosaveDiff pipe), so we
// expose the inverse-op metadata as pure, dependency-free builders here (next to
// the workout-builder mutation hooks) rather than baking it into the screen.
// Keeping them pure makes the inverse-op contract directly unit-testable.
//
// NB: these do NOT add backend behaviour — they only describe how to reverse an
// edit the existing mutations already perform.

/**
 * The shape the builder edits per row. A superset of CommandRowSnapshot with the
 * stable on-device `clientId` the screen uses to resolve a row to its live
 * server `rowId` at undo time.
 */
export interface BuilderRowLike extends CommandRowSnapshot {
  /** Stable on-device identity, minted once when the row first exists. */
  clientId: string;
}

/** Snapshot the persisted fields of a builder row (drops the transient clientId). */
export function snapshotBuilderRow(row: BuilderRowLike): CommandRowSnapshot {
  return {
    rowId: row.rowId,
    exerciseExternalId: row.exerciseExternalId,
    displayName: row.displayName,
    sets: row.sets,
    repsOrDurationSeconds: row.repsOrDurationSeconds,
    restSeconds: row.restSeconds,
    weightLbs: row.weightLbs,
    supersetGroupId: row.supersetGroupId,
    notes: row.notes,
  };
}

/** Forward `addExercise` → push metadata (inverse removes the row by clientId). */
export function actionForAddExercise(clientId: string): BuilderAction {
  return { kind: 'addExercise', clientId };
}

/**
 * Forward `removeExercise` → push metadata. Captures the FULL row BEFORE removal
 * and the index it occupied, so the inverse re-adds it at the original position.
 */
export function actionForRemoveExercise(
  row: BuilderRowLike,
  fromIndex: number,
): BuilderAction {
  return { kind: 'removeExercise', row: snapshotBuilderRow(row), fromIndex };
}

/** Forward `reorderExercise` → push metadata (inverse swaps from/to). */
export function actionForReorderExercise(
  clientId: string,
  fromIndex: number,
  toIndex: number,
): BuilderAction {
  return { kind: 'reorderExercise', clientId, fromIndex, toIndex };
}

/**
 * Forward `editExerciseField` → push metadata. Captures the PREVIOUS value of
 * the edited field (BEFORE the edit) so the inverse writes it back.
 */
export function actionForEditExerciseField(
  clientId: string,
  field: keyof CommandRowSnapshot,
  previousValue: CommandRowSnapshot[keyof CommandRowSnapshot],
): BuilderAction {
  return { kind: 'editExerciseField', clientId, field, previousValue };
}

/**
 * Forward `editPlan` → push metadata. Captures the previous values of exactly
 * the patched plan fields so the inverse restores them.
 */
export function actionForEditPlan(
  planId: string,
  previousPatch: CommandPlanPatch,
): BuilderAction {
  return { kind: 'editPlan', planId, previousPatch };
}

export function useWorkoutPlans() {
  return useQuery<WorkoutPlan[]>({
    queryKey: ['workout-plans'],
    queryFn: () => workoutBuilderApi.listPlans().then((r) => r.data),
    staleTime: FIVE_MIN_MS,
  });
}

export function useWorkoutPlan(planId: string | undefined) {
  return useQuery<WorkoutPlan>({
    queryKey: ['workout-plans', planId],
    queryFn: () =>
      workoutBuilderApi.getPlan(planId as string).then((r) => r.data),
    enabled: !!planId,
    staleTime: FIVE_MIN_MS,
  });
}

export function useCreateWorkoutPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkoutPlanInput) =>
      workoutBuilderApi.createPlan(input).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workout-plans'] });
    },
  });
}

export function useUpdateWorkoutPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { planId: string; input: UpdateWorkoutPlanInput }) =>
      workoutBuilderApi.updatePlan(args.planId, args.input).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['workout-plans'] });
      qc.invalidateQueries({ queryKey: ['workout-plans', vars.planId] });
    },
  });
}

export function useArchiveWorkoutPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      workoutBuilderApi.archivePlan(planId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workout-plans'] });
    },
  });
}

export function useSetWorkoutExercises() {
  const qc = useQueryClient();
  return useMutation<
    WorkoutPlanExercise[],
    Error,
    { planId: string; rows: UpsertExerciseRowInput[] }
  >({
    mutationFn: (args) =>
      workoutBuilderApi
        .setExercises(args.planId, args.rows)
        .then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['workout-plans', vars.planId] });
    },
  });
}

export function useAssignWorkoutPlan() {
  const qc = useQueryClient();
  return useMutation<
    ClientWorkoutAssignment,
    Error,
    { planId: string; input: CreateAssignmentInput }
  >({
    mutationFn: (args) =>
      workoutBuilderApi.assignPlan(args.planId, args.input).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ['workout-plans', vars.planId, 'assignments'],
      });
    },
  });
}

export function useMyWorkoutAssignments() {
  return useQuery<ClientWorkoutAssignmentWithPlan[]>({
    queryKey: ['assignments', 'me'],
    queryFn: () =>
      workoutBuilderApi.listMyAssignments().then((r) => r.data),
    staleTime: FIVE_MIN_MS,
  });
}

export function useMyWorkoutAssignment(assignmentId: string | undefined) {
  return useQuery<ClientWorkoutAssignmentWithPlan>({
    queryKey: ['assignments', assignmentId],
    queryFn: () =>
      workoutBuilderApi
        .getMyAssignment(assignmentId as string)
        .then((r) => r.data),
    enabled: !!assignmentId,
    staleTime: FIVE_MIN_MS,
  });
}

export function useCompleteAssignment() {
  const qc = useQueryClient();
  return useMutation<
    ClientWorkoutAssignment,
    Error,
    { assignmentId: string; input: CompleteAssignmentInput }
  >({
    mutationFn: (args) =>
      workoutBuilderApi
        .completeMyAssignment(args.assignmentId, args.input)
        .then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['assignments', 'me'] });
      qc.invalidateQueries({ queryKey: ['assignments', vars.assignmentId] });
    },
  });
}
