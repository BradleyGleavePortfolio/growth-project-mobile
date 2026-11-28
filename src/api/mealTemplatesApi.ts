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
 * The app no longer calls the old (Sprint A) `/meal-plans/*` surface
 * (MEALPLAN-RETIRE); this client is the only meal-plan path.
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
  /** PLAN-SWAPS-BE: the options clients can pick instead, in his order (at most 10; [] clears; never null). */
  swap_template_ids?: string[];
  /** PLAN-SWAPS-BE: one recipe he created, or null for none (never ""). */
  recipe_id?: string | null;
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
  /** PLAN-SWAPS-BE: on the coach's own reads; a client's slot.meal_template has neither (the server strips them). */
  swap_template_ids?: string[];
  recipe_id?: string | null;
}

// ─── DailyMealPlan + slots ───────────────────────────────────────────────────

export interface DailyPlanSlotInput {
  meal_template_id: string;
  slot_label: SlotLabel;
  /** 0-indexed; if omitted the server uses array-position. */
  order?: number;
  /** C2-C0: local "HH:MM" on the 24-hour clock; null or absent = no time. */
  time_of_day?: string | null;
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
  /** C2-C0 (backend 96f20061): the coach's planned time, local "HH:MM" on the 24-hour clock; null when none. */
  time_of_day?: string | null;
  meal_template: MealTemplate;
  /** PLAN-SWAPS-BE (b#1221): the coach's swaps for this meal, only her current coach's live meals; carbs_g and fats_g come with PLAN-SWAPS-MACROS-BE. */
  swaps?: PlanSwap[];
  /** PLAN-SWAPS-BE: the meal's recipe, null unless she can open it. */
  recipe_id?: string | null;
}

/** One swap the coach offers for a plan meal (CONTRACT 6641656549 on b#1221). */
export interface PlanSwap {
  id: string;
  name: string;
  calories_kcal: number;
  protein_g: number;
  carbs_g?: number;
  fats_g?: number;
}

/** PLAN-SWAPS-BE: one meal change the coach made to one of her current plans today (oldest first, at most 100). */
export interface PlanChange {
  plan_id: string;
  slot_id: string;
  slot_label: SlotLabel;
  from_template_id: string | null;
  from_name: string | null;
  to_template_id: string | null;
  to_name: string | null;
  changed_at: string;
}

export interface DailyMealPlan {
  id: string;
  coach_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  archived_at: string | null;
  /** PLAN-SWAPS-BE: when the coach last changed the plan. */
  updated_at?: string;
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
  /** PLAN-SWAPS-BE: today's meal changes; empty when ?date is not her today. */
  changes_today?: PlanChange[];
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
