/**
 * useMealTemplates — React Query hooks over mealTemplatesApi.
 *
 * Coach surface: meal template CRUD, daily plan CRUD, plan assignment.
 * Client surface: /me/meal-plan/today.
 *
 * Query keys:
 *   ['meal-templates']                      — coach template list
 *   ['meal-templates', id]                  — single template
 *   ['daily-meal-plans']                    — coach plan list
 *   ['daily-meal-plans', id]                — single plan
 *   ['daily-meal-plans', id, 'assignments'] — plan assignments
 *   ['meal-plan', 'today', dateIso?]        — client today view
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  mealTemplatesApi,
  type AssignDailyPlanInput,
  type ClientTodayResponse,
  type CreateDailyMealPlanInput,
  type CreateMealTemplateInput,
  type DailyMealPlan,
  type DailyMealPlanAssignment,
  type MealTemplate,
  type UpdateDailyMealPlanInput,
  type UpdateMealTemplateInput,
} from '../api/mealTemplatesApi';

const FIVE_MIN_MS = 5 * 60 * 1000;

// ---- Templates -------------------------------------------------------------

export function useMealTemplates() {
  return useQuery<MealTemplate[]>({
    queryKey: ['meal-templates'],
    queryFn: () => mealTemplatesApi.listTemplates().then((r) => r.data),
    staleTime: FIVE_MIN_MS,
  });
}

export function useMealTemplate(id: string | undefined) {
  return useQuery<MealTemplate>({
    queryKey: ['meal-templates', id],
    queryFn: () =>
      mealTemplatesApi.getTemplate(id as string).then((r) => r.data),
    enabled: !!id,
    staleTime: FIVE_MIN_MS,
  });
}

export function useCreateMealTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMealTemplateInput) =>
      mealTemplatesApi.createTemplate(input).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
    },
  });
}

export function useUpdateMealTemplate() {
  const qc = useQueryClient();
  return useMutation<
    MealTemplate,
    Error,
    { id: string; input: UpdateMealTemplateInput }
  >({
    mutationFn: (args) =>
      mealTemplatesApi.updateTemplate(args.id, args.input).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
      qc.invalidateQueries({ queryKey: ['meal-templates', vars.id] });
    },
  });
}

export function useArchiveMealTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      mealTemplatesApi.archiveTemplate(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meal-templates'] });
    },
  });
}

// ---- Daily plans -----------------------------------------------------------

export function useDailyMealPlans() {
  return useQuery<DailyMealPlan[]>({
    queryKey: ['daily-meal-plans'],
    queryFn: () => mealTemplatesApi.listPlans().then((r) => r.data),
    staleTime: FIVE_MIN_MS,
  });
}

export function useDailyMealPlan(id: string | undefined) {
  return useQuery<DailyMealPlan>({
    queryKey: ['daily-meal-plans', id],
    queryFn: () =>
      mealTemplatesApi.getPlan(id as string).then((r) => r.data),
    enabled: !!id,
    staleTime: FIVE_MIN_MS,
  });
}

export function useCreateDailyMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDailyMealPlanInput) =>
      mealTemplatesApi.createPlan(input).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-meal-plans'] });
    },
  });
}

export function useUpdateDailyMealPlan() {
  const qc = useQueryClient();
  return useMutation<
    DailyMealPlan,
    Error,
    { id: string; input: UpdateDailyMealPlanInput }
  >({
    mutationFn: (args) =>
      mealTemplatesApi.updatePlan(args.id, args.input).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['daily-meal-plans'] });
      qc.invalidateQueries({ queryKey: ['daily-meal-plans', vars.id] });
    },
  });
}

export function useAssignDailyMealPlan() {
  const qc = useQueryClient();
  return useMutation<
    DailyMealPlanAssignment,
    Error,
    { planId: string; input: AssignDailyPlanInput }
  >({
    mutationFn: (args) =>
      mealTemplatesApi.assignPlan(args.planId, args.input).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({
        queryKey: ['daily-meal-plans', vars.planId, 'assignments'],
      });
      qc.invalidateQueries({ queryKey: ['meal-plan', 'today'] });
    },
  });
}

// ---- Client today view -----------------------------------------------------

export function useMealPlanToday(dateIso?: string) {
  return useQuery<ClientTodayResponse>({
    queryKey: ['meal-plan', 'today', dateIso ?? null],
    queryFn: () => mealTemplatesApi.todayForClient(dateIso).then((r) => r.data),
    staleTime: FIVE_MIN_MS,
  });
}
