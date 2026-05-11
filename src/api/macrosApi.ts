/**
 * macrosApi
 *
 * Typed client for the Sprint B v2 macros endpoints (PR #188 backend).
 * Coach surface lives under `/coach/clients/:clientId/macros` and
 * `/coach/macros/*`; client surface is `/me/macros/current`.
 *
 * Backend contract source of truth:
 *   src/macros/macros.controller.ts
 *   src/macros/macros.dto.ts
 *   src/macros/macros.service.ts (PresetInput, PresetOutput types)
 *
 * Units: metric throughout. The mobile UI must convert imperial inputs
 * (lbs, inches) to (kg, cm) before invoking computePreset — the backend
 * does NOT coerce.
 */

import api from '../services/api';

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateMacroTargetInput {
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  fiber_g?: number;
  notes?: string;
  /** ISO 8601. Defaults to "now" server-side. */
  effective_from?: string;
}

export type MacroSex = 'male' | 'female';
export type MacroActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';
export type MacroGoal = 'cut' | 'maintain' | 'bulk';

export interface MacroPresetInput {
  weight_kg: number;
  height_cm: number;
  age_years: number;
  sex: MacroSex;
  activity_level: MacroActivityLevel;
  goal: MacroGoal;
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface MacroTarget {
  id: string;
  client_id: string;
  coach_id: string;
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  fiber_g: number | null;
  notes: string | null;
  effective_from: string;
  created_at: string;
  archived_at: string | null;
}

export interface MacroPresetOutput {
  calories_kcal: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  fiber_g: number;
  /** Server-rendered "Mifflin-St Jeor BMR X, activity factor Y, ..." string. */
  rationale: string;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const macrosApi = {
  // ---- Coach surface ------------------------------------------------------
  createForClient: (clientId: string, input: CreateMacroTargetInput) =>
    api.post<MacroTarget>(`/coach/clients/${clientId}/macros`, input),

  listForClient: (clientId: string) =>
    api.get<MacroTarget[]>(`/coach/clients/${clientId}/macros`),

  currentForClient: (clientId: string) =>
    api.get<MacroTarget | null>(
      `/coach/clients/${clientId}/macros/current`,
    ),

  archive: (targetId: string) =>
    api.delete<{ archived: number }>(`/coach/macros/${targetId}`),

  /**
   * Stateless preset calculator. Pure function on the server. Inputs
   * are metric; the UI must convert before posting.
   */
  computePreset: (input: MacroPresetInput) =>
    api.post<MacroPresetOutput>('/coach/macros/preset', input),

  // ---- Client surface -----------------------------------------------------
  currentForSelf: () => api.get<MacroTarget | null>('/me/macros/current'),
};
