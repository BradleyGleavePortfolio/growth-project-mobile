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

const FIVE_MIN_MS = 5 * 60 * 1000;

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
