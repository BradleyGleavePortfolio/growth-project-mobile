/**
 * mealTemplatesApi
 *
 * Typed client for the Sprint B v2 real-meal-plans endpoints
 * (PR #188 backend). Coach side composes reusable MealTemplate rows
 * into DailyMealPlans and assigns them per-client over a date range.
 *
 * Backend contract source of truth:
 *   src/real-meal-plans/real-meal-plans.controller.ts
 *   src/real-meal-plans/real-meal-plans.dto.ts
 *
 * The legacy `mealPlansApi` in src/services/api.ts targets a separate
 * (Sprint A) `/meal-plans/*` surface and is intentionally left alone.
 */

import api from '../services/api';

// ─── Slot label enum (mirror) ────────────────────────────────────────────────

export const SLOT_LABELS = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'preworkout',
  'postworkout',
] as const;
export type SlotLabel = (typeof SLOT_LABELS)[number];

// ─── MealTemplate ────────────────────────────────────────────────────────────

export interface MealTemplateItem {
  name: string;
  grams?: number;
  portion?: string;
}

export interface CreateMealTemplateInput {
  name: string;
  description?: string;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  fiber_g?: number;
  items?: MealTemplateItem[];
}

export type UpdateMealTemplateInput = Partial<CreateMealTemplateInput>;

export interface MealTemplate {
  id: string;
  coach_id: string;
  name: string;
  description: string | null;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  fiber_g: number | null;
  items: MealTemplateItem[] | null;
  created_at: string;
  archived_at: string | null;
}

// ─── DailyMealPlan + slots ───────────────────────────────────────────────────

export interface DailyPlanSlotInput {
  meal_template_id: string;
  slot_label: SlotLabel;
  /** 0-indexed; if omitted the server uses array-position. */
  order?: number;
}

export interface CreateDailyMealPlanInput {
  name: string;
  notes?: string;
  slots: DailyPlanSlotInput[];
}

export type UpdateDailyMealPlanInput = Partial<CreateDailyMealPlanInput>;

export interface DailyMealPlanSlot {
  id: string;
  daily_meal_plan_id: string;
  meal_template_id: string;
  slot_label: SlotLabel;
  order: number;
  meal_template: MealTemplate;
}

export interface DailyMealPlan {
  id: string;
  coach_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  archived_at: string | null;
  slots: DailyMealPlanSlot[];
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export interface AssignDailyPlanInput {
  client_id: string;
  /** ISO 8601 date (YYYY-MM-DD). */
  starts_on: string;
  /** ISO 8601 date; omit for open-ended. */
  ends_on?: string;
}

export interface DailyMealPlanAssignment {
  id: string;
  daily_meal_plan_id: string;
  client_id: string;
  assigned_by_coach_id: string;
  starts_on: string;
  ends_on: string | null;
  created_at: string;
}

export interface DailyMealPlanAssignmentWithPlan
  extends DailyMealPlanAssignment {
  daily_meal_plan: DailyMealPlan;
}

export interface ClientTodayResponse {
  /** YYYY-MM-DD echoed by the server. */
  date: string;
  assignments: DailyMealPlanAssignmentWithPlan[];
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const mealTemplatesApi = {
  // ---- MealTemplate CRUD (coach) ------------------------------------------
  listTemplates: () => api.get<MealTemplate[]>('/coach/meal-templates'),

  getTemplate: (id: string) =>
    api.get<MealTemplate>(`/coach/meal-templates/${id}`),

  createTemplate: (input: CreateMealTemplateInput) =>
    api.post<MealTemplate>('/coach/meal-templates', input),

  updateTemplate: (id: string, input: UpdateMealTemplateInput) =>
    api.patch<MealTemplate>(`/coach/meal-templates/${id}`, input),

  archiveTemplate: (id: string) =>
    api.delete<{ archived: number }>(`/coach/meal-templates/${id}`),

  // ---- DailyMealPlan CRUD (coach) -----------------------------------------
  listPlans: () => api.get<DailyMealPlan[]>('/coach/daily-meal-plans'),

  getPlan: (id: string) =>
    api.get<DailyMealPlan>(`/coach/daily-meal-plans/${id}`),

  createPlan: (input: CreateDailyMealPlanInput) =>
    api.post<DailyMealPlan>('/coach/daily-meal-plans', input),

  updatePlan: (id: string, input: UpdateDailyMealPlanInput) =>
    api.patch<DailyMealPlan>(`/coach/daily-meal-plans/${id}`, input),

  archivePlan: (id: string) =>
    api.delete<{ archived: number }>(`/coach/daily-meal-plans/${id}`),

  // ---- Assignments (coach) -------------------------------------------------
  assignPlan: (planId: string, input: AssignDailyPlanInput) =>
    api.post<DailyMealPlanAssignment>(
      `/coach/daily-meal-plans/${planId}/assignments`,
      input,
    ),

  listAssignmentsForPlan: (planId: string) =>
    api.get<DailyMealPlanAssignment[]>(
      `/coach/daily-meal-plans/${planId}/assignments`,
    ),

  // ---- Client today-view ---------------------------------------------------
  todayForClient: (dateIso?: string) => {
    const query = dateIso
      ? `?date=${encodeURIComponent(dateIso)}`
      : '';
    return api.get<ClientTodayResponse>(`/me/meal-plan/today${query}`);
  },
};
