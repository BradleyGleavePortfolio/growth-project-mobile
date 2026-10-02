/**
 * onboardingPayload — pure, defensive parsing of the onboarding complete
 * payload (`POST /me/onboarding/complete` 200 body, or the `GET
 * /me/onboarding` read used as a fallback by TutorialHost). The exact GET
 * envelope is owned by the backend builder, so this accepts the payload at
 * the top level or under `complete` / `result` / `payload`. Unknown or
 * malformed fields are dropped, never defaulted.
 */
import type { MacroTarget } from '../api/macrosApi';
import type {
  OnboardingCompletePayload,
  OnboardingMacros,
  OnboardingProgram,
  OnboardingSpace,
} from './types';

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function parseMacros(raw: unknown): OnboardingMacros | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const calories = num(r.calories);
  const protein = num(r.protein_g);
  const carbs = num(r.carbs_g);
  const fat = num(r.fat_g);
  if (calories == null || protein == null || carbs == null || fat == null) return null;
  return {
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    method: typeof r.method === 'string' ? r.method : undefined,
    floor_applied: r.floor_applied === true,
  };
}

function parseProgram(raw: unknown): OnboardingProgram | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  return {
    id: typeof r.id === 'string' ? r.id : '',
    name: r.name.trim(),
    days_per_week: num(r.days_per_week) ?? undefined,
    weeks: num(r.weeks) ?? undefined,
    why: Array.isArray(r.why) ? r.why.filter((w): w is string => typeof w === 'string') : [],
  };
}

function parseSpaces(raw: unknown): OnboardingSpace[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .filter((s) => typeof s.name === 'string' && s.name)
    .map((s) => ({ id: String(s.id ?? ''), name: String(s.name) }));
}

export function parseOnboardingPayload(raw: unknown): OnboardingCompletePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  for (const key of ['complete', 'result', 'payload']) {
    const inner = r[key];
    if (inner && typeof inner === 'object') {
      const nested = parseOnboardingPayload(inner);
      if (nested) return nested;
    }
  }
  const macros = parseMacros(r.macros);
  const program = parseProgram(r.program);
  if (!macros && !program) return null;
  const coachRaw = r.coach as Record<string, unknown> | undefined;
  const coach =
    coachRaw && typeof coachRaw.display_name === 'string' && coachRaw.display_name.trim()
      ? { id: String(coachRaw.id ?? ''), display_name: coachRaw.display_name.trim() }
      : null;
  return { macros, program, spaces: parseSpaces(r.spaces), coach };
}

export function macrosFromTarget(t: MacroTarget | null | undefined): OnboardingMacros | null {
  if (!t) return null;
  return parseMacros({
    calories: t.calories_kcal,
    protein_g: t.protein_g,
    carbs_g: t.carbs_g,
    fat_g: t.fats_g,
  });
}
