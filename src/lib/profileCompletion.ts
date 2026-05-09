/**
 * Profile completion gating.
 *
 * Cold outbound depends on the backend having enough personalization data
 * to produce a credible plan. The mobile app captures these fields during
 * onboarding, but legacy users (and anyone who skipped a step) can land on
 * Home with a half-empty profile. This module is the single source of truth
 * for "what counts as complete" so Home, Profile, and the Edit screen all
 * agree on the same gate.
 *
 * Field shape matches the snake_case payload returned by `/auth/me` and
 * stored under the `user_data.profile` AsyncStorage key.
 */
import type { CurrentUser } from '../hooks/useCurrentUser';

export type ProfileField =
  | 'sex'
  | 'dob'
  | 'target_weight'
  | 'diet_type'
  | 'workout_days_per_week'
  | 'gym_membership'
  // TDEE-critical fields added when EditProfile expanded to capture them.
  // The lean onboarding flow only collects a subset; the rest are surfaced
  // here so the "Finish your profile" nudge actually leads somewhere
  // meaningful rather than dead-ending on the first six.
  | 'current_weight'
  | 'height_cm'
  | 'activity_level'
  | 'primary_goal'
  // Safety: dietary restrictions / allergies. The recipe engine reads
  // this; an empty value while a real allergy exists is a liability,
  // so we count it as required and block "complete" until answered.
  // The user can still choose "None" — see EditProfileScreen's chip set.
  | 'diet_restrictions';

export interface ProfileCompletionStatus {
  missing: ProfileField[];
  filled: ProfileField[];
  isComplete: boolean;
  percentComplete: number;
}

const REQUIRED_FIELDS: ProfileField[] = [
  'sex',
  'dob',
  'target_weight',
  'diet_type',
  'workout_days_per_week',
  'gym_membership',
  // Added Wave 5 (sale-readiness): TDEE inputs + dietary safety.
  'current_weight',
  'height_cm',
  'activity_level',
  'primary_goal',
  'diet_restrictions',
];

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function getProfileCompletion(
  user: Pick<CurrentUser, 'profile'> | null | undefined,
): ProfileCompletionStatus {
  const profile = user?.profile;
  const filled: ProfileField[] = [];
  const missing: ProfileField[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = profile ? (profile as Record<string, unknown>)[field] : undefined;
    // diet_restrictions has special semantics: a *present* array — even an
    // empty one — is an explicit answer ("I have no restrictions"). Only
    // an undefined / null / non-array value counts as unanswered. This is
    // the safety gate the Recipes prompt and completion nudge depend on.
    if (field === 'diet_restrictions') {
      if (Array.isArray(value)) filled.push(field);
      else missing.push(field);
      continue;
    }
    if (hasValue(value)) {
      filled.push(field);
    } else {
      missing.push(field);
    }
  }

  const total = REQUIRED_FIELDS.length;
  const pct = total === 0 ? 100 : Math.round((filled.length / total) * 100);

  return {
    missing,
    filled,
    isComplete: missing.length === 0,
    percentComplete: pct,
  };
}

/**
 * Human-readable label for a missing field — used in nudge copy. Kept as a
 * small lookup so the wording is reviewed in one place.
 */
export const FIELD_LABEL: Record<ProfileField, string> = {
  sex: 'Sex',
  dob: 'Date of birth',
  target_weight: 'Target weight',
  diet_type: 'Diet preference',
  workout_days_per_week: 'Workout days per week',
  gym_membership: 'Equipment access',
  current_weight: 'Current weight',
  height_cm: 'Height',
  activity_level: 'Activity level',
  primary_goal: 'Primary goal',
  diet_restrictions: 'Allergies and restrictions',
};

export function summarizeMissing(missing: ProfileField[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) return FIELD_LABEL[missing[0]];
  if (missing.length === 2) return `${FIELD_LABEL[missing[0]]} and ${FIELD_LABEL[missing[1]]}`;
  const head = missing.slice(0, 2).map((f) => FIELD_LABEL[f]).join(', ');
  return `${head}, and ${missing.length - 2} more`;
}

/**
 * Form-state shape the EditProfile screen tracks. Strings come straight from
 * TextInputs; ChoicePill selections are typed unions or `null` when nothing
 * is picked yet. Kept here so the API-mapping helper below is unit-testable
 * without rendering the screen.
 */
export interface EditProfileFormState {
  sex: 'male' | 'female' | null;
  dob: string;
  targetWeight: string;
  dietType: string | null;
  workoutDaysPerWeek: number | null;
  gymMembership: string | null;
  // Wave 5 expansion — TDEE inputs + dietary safety.
  currentWeight: string;
  heightCm: string;
  activityLevel:
    | 'sedentary'
    | 'light'
    | 'moderate'
    | 'active'
    | 'very_active'
    | null;
  primaryGoal:
    | 'lose_fast'
    | 'lose_moderate'
    | 'maintain'
    | 'gain'
    | 'gain_fast'
    | 'mobility'
    | null;
  /** Multi-select chip set. Empty array means "answered: none". */
  dietRestrictions: string[];
  /**
   * True once the user has explicitly engaged the restrictions section
   * (saved with selections OR explicitly chose "None"). Without this, an
   * empty array could mean either "I have none" or "I haven't answered" —
   * the safety gate (Recipes prompt + completion gate) needs the
   * difference.
   */
  dietRestrictionsAnswered: boolean;
}

/**
 * Build the snake_case payload that PUT /profile expects. Empty / unset
 * fields are omitted so the backend never receives `null` for a field the
 * user did not touch — this preserves whatever onboarding wrote earlier.
 */
export function buildProfileUpdatePayload(
  form: EditProfileFormState,
): Record<string, string | number | string[]> {
  const payload: Record<string, string | number | string[]> = {};
  if (form.sex) payload.sex = form.sex;
  if (form.dob.trim()) payload.dob = form.dob.trim();
  if (form.targetWeight.trim()) {
    const n = Number(form.targetWeight);
    if (Number.isFinite(n) && n > 0) payload.target_weight = n;
  }
  if (form.dietType) payload.diet_type = form.dietType;
  if (form.workoutDaysPerWeek !== null) {
    payload.workout_days_per_week = form.workoutDaysPerWeek;
  }
  if (form.gymMembership) payload.gym_membership = form.gymMembership;
  if (form.currentWeight.trim()) {
    const n = Number(form.currentWeight);
    if (Number.isFinite(n) && n > 0) payload.current_weight = n;
  }
  if (form.heightCm.trim()) {
    const n = Number(form.heightCm);
    if (Number.isFinite(n) && n > 0) payload.height_cm = n;
  }
  if (form.activityLevel) payload.activity_level = form.activityLevel;
  if (form.primaryGoal) payload.primary_goal = form.primaryGoal;
  if (form.dietRestrictionsAnswered) {
    // We always send the array (even empty) once the user answered, so the
    // backend can record "no restrictions" definitively. Recipe engine
    // treats an empty array as "answered, none" vs absent as "unknown".
    payload.diet_restrictions = form.dietRestrictions;
  }
  return payload;
}
