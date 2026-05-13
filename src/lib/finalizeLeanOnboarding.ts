/**
 * finalizeLeanOnboarding — Bridge between the lean onboarding screens
 * (LeanQ1–Q4) and the backend profile + macro-target store.
 *
 * Background
 * ──────────
 * The lean flow was originally writing answers to AsyncStorage and never
 * calling `profileApi.update`. New users landed on Home with
 * `protein_target=undefined` forever. This file is the missing wiring. It
 * mirrors the legacy `OnboardingResults.handleStart` codepath without
 * surfacing the legacy 10-step screen.
 *
 * Called from
 * ───────────
 * - `LeanQ4MetricsScreen.finishOnboarding` (the canonical "save & continue")
 * - `LeanQ1`, `LeanQ2`, `LeanQ3` skip handlers (so any path that flips
 *   `onboarding_complete` also tries the backend post)
 * - `useLeanOnboardingReconcile` on app open (retry if the previous attempt
 *   bailed offline)
 *
 * Behaviour
 * ─────────
 * - Loads `onboarding_data` from AsyncStorage
 * - Maps lean-vocab fields (`lose_weight`/`build_muscle`/`maintain` and
 *   `new`/`some`/`experienced`) to legacy/backend vocab
 *   (`lose_moderate`/`gain`/`maintain` and `beginner`/`intermediate`/`advanced`)
 * - Defaults `activity_level` to `'moderate'` so the TDEE bucket is sane
 *   until the user provides a real answer
 * - If weight + height + dob + sex are all present → computes BMR / TDEE /
 *   macros via `calcBMR` / `calcTDEE` / `calcMacros` and includes the
 *   targets in the PUT payload
 * - On API failure: returns `{ ok: false }` and leaves the AsyncStorage
 *   state intact so the reconcile hook can retry
 * - On success: writes `macro_targets` to AsyncStorage so Home's macro
 *   grid picks them up immediately, and refreshes the local `user_data`
 *   profile slice so the in-memory CurrentUser reflects the new targets
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { profileApi } from '../services/api';
import { calcBMR, calcTDEE, calcMacros, calculateAge } from '../utils/nutrition';
import { getOnboardingData } from '../utils/onboardingStore';
import { track } from './analytics';
import { AnalyticsEvents } from '../analytics/events';

// ─── Public types ────────────────────────────────────────────────────────────

export interface FinalizeResult {
  ok: boolean;
  /** True when we computed and saved macro targets. */
  computedMacros: boolean;
  /** Reason for failure when ok=false; useful in tests + telemetry. */
  reason?: 'no_user' | 'api_error' | 'storage_error';
}

// ─── Lean → backend enum mappings ────────────────────────────────────────────

// Lean Q1 vocabulary → legacy `primary_goal` enum the backend speaks.
// Kept conservative: lean "Lose Weight" → moderate deficit (-500 kcal),
// not the aggressive -750 bucket. We can offer a "speed" toggle later
// from EditProfile without renaming the lean answers.
const GOAL_MAP: Record<string, string> = {
  lose_weight: 'lose_moderate',
  build_muscle: 'gain',
  maintain: 'maintain',
};

// Lean Q2 vocabulary → legacy `fitness_level` enum.
const FITNESS_MAP: Record<string, string> = {
  new: 'beginner',
  some: 'intermediate',
  experienced: 'advanced',
};

/** Public accessor — exported for tests. */
export function mapLeanGoalToLegacy(leanGoal: string | undefined): string | null {
  if (!leanGoal) return null;
  return GOAL_MAP[leanGoal] ?? leanGoal;
}

/** Public accessor — exported for tests. */
export function mapLeanFitnessToLegacy(level: string | undefined): string | null {
  if (!level) return null;
  return FITNESS_MAP[level] ?? level;
}

// ─── Macro computation helper ─────────────────────────────────────────────────

interface MacroTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tdee: number;
}

function tryComputeMacros(d: {
  currentWeight?: number;
  height?: number;
  dob?: string;
  sex?: 'male' | 'female';
  activityLevel?: string;
  primaryGoal?: string;
}): MacroTargets | null {
  // BMR formula needs all four inputs. If any are missing we skip the
  // macro compute entirely — the user can finish profile setup later
  // and we'll recompute then.
  if (!d.currentWeight || !d.height || !d.dob || !d.sex) return null;
  const age = calculateAge(d.dob);
  if (!Number.isFinite(age) || age <= 0) return null;
  // Weight is stored in kg; nutrition.ts BMR/macro helpers expect lbs.
  const weightLbs = d.currentWeight / 0.45359237;
  const activity = d.activityLevel || 'moderate';
  const goal = d.primaryGoal || 'maintain';
  const bmr = calcBMR(weightLbs, d.height, age, d.sex);
  const tdee = calcTDEE(bmr, activity);
  const out = calcMacros(weightLbs, tdee, goal);
  return {
    calories: out.calories,
    protein: out.protein,
    carbs: out.carbs,
    fat: out.fat,
    tdee: out.tdee,
  };
}

// ─── Internal: refresh the local user_data cache so Home reflects targets ─────
async function refreshLocalProfile(payload: Record<string, unknown>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('user_data');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const nextProfile = { ...(parsed.profile ?? {}), ...payload };
    await AsyncStorage.setItem(
      'user_data',
      JSON.stringify({ ...parsed, profile: nextProfile }),
    );
  } catch {
    // Cache refresh is best-effort; the next /auth/me will resync.
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Persist the lean onboarding answers to the backend. Idempotent — safe
 * to call multiple times. Returns `{ ok: false }` on API failure and
 * leaves AsyncStorage untouched so a subsequent retry can pick up where
 * this attempt bailed.
 */
export async function finalizeLeanOnboarding(): Promise<FinalizeResult> {
  let d;
  try {
    d = await getOnboardingData();
  } catch {
    return { ok: false, computedMacros: false, reason: 'storage_error' };
  }

  const primary_goal = mapLeanGoalToLegacy(d.primaryGoal);
  const fitness_level = mapLeanFitnessToLegacy(d.fitnessLevel);

  // Build PUT payload. Snake_case fields match the backend /profile schema.
  // Only include fields the user actually answered — never overwrite real
  // data with `null` for a question they skipped.
  const payload: Record<string, unknown> = {
    onboarding_completed: true,
  };
  if (d.sex) payload.sex = d.sex;
  if (d.dob) payload.dob = d.dob;
  if (typeof d.currentWeight === 'number') payload.current_weight = d.currentWeight;
  if (typeof d.targetWeight === 'number') payload.target_weight = d.targetWeight;
  if (typeof d.height === 'number') payload.height_cm = d.height;
  if (primary_goal) payload.primary_goal = primary_goal;
  if (fitness_level) payload.fitness_level = fitness_level;
  if (d.dietType) payload.diet_type = d.dietType;
  if (Array.isArray(d.restrictions) && d.restrictions.length > 0) {
    payload.diet_restrictions = d.restrictions;
  }
  if (typeof d.mealsPerDay === 'number') payload.meals_per_day = d.mealsPerDay;
  if (d.intent) payload.lean_intent = d.intent;

  // Default `activity_level` to 'moderate' if the user hasn't supplied
  // anything yet — keeps the TDEE bucket sane until EditProfile captures
  // a real answer. Never blindly accept whatever was written; ignore any
  // legacy value that isn't one of the 5 valid TDEE keys (defends against
  // the previously-shipped bug where Q3 wrote 'workout'/'explore' here).
  const VALID_ACTIVITY = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
  const activityForPayload =
    d.activityLevel && VALID_ACTIVITY.includes(d.activityLevel)
      ? d.activityLevel
      : 'moderate';
  payload.activity_level = activityForPayload;

  // Compute macros if we have enough signal.
  const macros = tryComputeMacros({
    currentWeight: d.currentWeight,
    height: d.height,
    dob: d.dob,
    sex: d.sex,
    activityLevel: activityForPayload,
    primaryGoal: primary_goal ?? undefined,
  });
  if (macros) {
    payload.tdee = macros.tdee;
    payload.calorie_target = macros.calories;
    payload.protein_target = macros.protein;
    payload.carbs_target = macros.carbs;
    payload.fat_target = macros.fat;
  }

  // Hit the backend.
  try {
    await profileApi.update(payload);
  } catch (err) {
    console.error('finalizeLeanOnboarding: profileApi.update failed', err);
    return { ok: false, computedMacros: !!macros, reason: 'api_error' };
  }

  // Persist macro_targets locally so Home's macro grid picks them up
  // immediately without waiting for /auth/me.
  if (macros) {
    try {
      await AsyncStorage.setItem('macro_targets', JSON.stringify(macros));
    } catch {
      // Best-effort; backend has the source of truth.
    }
  }

  // Refresh local user_data cache so the in-memory CurrentUser reflects
  // the new targets and the "Finish your profile" nudge updates.
  await refreshLocalProfile(payload);

  // Mark synced so the reconcile hook stops retrying.
  try {
    await AsyncStorage.setItem('lean_onboarding_synced', 'true');
  } catch {
    // Non-fatal.
  }

  // Fire ONBOARDING_COMPLETED exactly once per device. The flag is checked
  // before track() so reconcile retries do not double-fire the funnel event.
  try {
    const fired = await AsyncStorage.getItem('analytics_onboarding_completed_fired');
    if (fired !== 'true') {
      track(AnalyticsEvents.ONBOARDING_COMPLETED, {
        computed_macros: !!macros,
        primary_goal: primary_goal ?? null,
        fitness_level: fitness_level ?? null,
      });
      await AsyncStorage.setItem('analytics_onboarding_completed_fired', 'true');
    }
  } catch {
    // analytics is best-effort; do not fail finalize on tracker errors.
  }

  return { ok: true, computedMacros: !!macros };
}
