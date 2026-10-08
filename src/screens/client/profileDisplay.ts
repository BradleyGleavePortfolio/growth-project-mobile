/**
 * profileDisplay — what the Profile screen prints for each saved answer.
 *
 * The profile reaches the app in two shapes: the server row (GET /profile,
 * sign-in, /auth/me: `current_weight_lbs`, `date_of_birth`, `goal_type`,
 * `dietary_pattern`, `has_gym_membership`, `macro_target_*`) and the older
 * names the app's own writes put in the local cache (`current_weight`, `dob`,
 * `primary_goal`, ...). Rows read both through `resolveProfileFields`, the
 * same resolver the completion line uses. Canonical goal and gym labels
 * do not infer a pace or equipment details the server did not save.
 * Raw enum values never reach the screen; a missing answer reads "Not set".
 */
import type { CurrentUser } from '../../hooks/useCurrentUser';
import type { MacroTarget } from '../../api/macrosApi';
import { resolveProfileFields } from '../../lib/profileCompletion';

export type ProfileValues = NonNullable<CurrentUser['profile']> & {
  macro_target_calories?: number | null;
  macro_target_protein_g?: number | null;
  macro_target_carbs_g?: number | null;
  macro_target_fat_g?: number | null;
};

export interface ProfileRow {
  label: string;
  value: string;
  missing: boolean;
}

export interface TargetRow {
  label: string;
  value: string;
}

const NOT_SET = 'Not set';

const SEX_LABEL: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  prefer_not_to_say: 'Prefer not to say',
};

// Same wording as the EditProfile choices.
const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: 'Sedentary',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Active',
  very_active: 'Very active',
};

const GOAL_LABEL: Record<string, string> = {
  lose_fast: 'Lose weight fast',
  lose_moderate: 'Lose weight steady',
  maintain: 'Maintain',
  gain: 'Build muscle',
  gain_fast: 'Gain mass',
  mobility: 'Mobility & wellness',
};

// Server goal column: no pace is stored, so none is shown.
const GOAL_TYPE_LABEL: Record<string, string> = {
  fat_loss: 'Lose weight',
  muscle_gain: 'Build muscle',
  maintenance: 'Maintain',
  performance: 'Performance',
};

const DIET_LABEL: Record<string, string> = {
  omnivore: 'Omnivore',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  keto: 'Keto',
  paleo: 'Paleo',
  mediterranean: 'Mediterranean',
  other: 'Other',
};

const GYM_LABEL: Record<string, string> = {
  yes_regular: 'Full gym, regular access',
  yes_occasional: 'Full gym, occasional access',
  home_gym: 'Home setup',
  no_gym: 'Bodyweight only',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function nonNegative(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function sentence(token: string): string {
  const s = token.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function label(map: Record<string, string>, v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  return map[v] ?? sentence(v);
}

/** "1990-05-12" -> "May 12, 1990". The calendar date is read as written, never shifted by time zone. */
export function formatBirthDate(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return v.trim();
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : v.trim();
}

function lbs(v: unknown): string | undefined {
  const n = positive(v);
  return n === undefined ? undefined : `${Math.round(n * 10) / 10} lbs`;
}

function restrictions(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return items.length === 0 ? 'None' : items.map(sentence).join(', ');
  }
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function row(rowLabel: string, value: string | undefined): ProfileRow {
  return { label: rowLabel, value: value ?? NOT_SET, missing: value === undefined };
}

export function buildProfileRows(
  user: Pick<CurrentUser, 'name' | 'email'> | null | undefined,
  profile: ProfileValues | null | undefined,
): ProfileRow[] {
  const p: ProfileValues = profile ?? {};
  const r = resolveProfileFields(p);
  const goal = typeof p.primary_goal === 'string' && p.primary_goal
    ? label(GOAL_LABEL, p.primary_goal)
    : label(GOAL_TYPE_LABEL, p.goal_type);
  const equipment = typeof p.gym_membership === 'string' && p.gym_membership
    ? label(GYM_LABEL, p.gym_membership)
    : typeof p.has_gym_membership === 'boolean'
      ? p.has_gym_membership ? 'Gym access' : 'No gym membership'
      : undefined;
  const days = positive(r.workout_days_per_week);
  const height = positive(r.height_cm);
  return [
    { label: 'Name', value: user?.name || 'No name set', missing: !user?.name },
    { label: 'Email', value: user?.email || '', missing: false },
    row('Sex', label(SEX_LABEL, r.sex)),
    row('Date of birth', formatBirthDate(r.dob)),
    row('Height', height === undefined ? undefined : `${Math.round(height)} cm`),
    row('Current weight', lbs(r.current_weight)),
    row('Target weight', lbs(r.target_weight)),
    row('Activity level', label(ACTIVITY_LABEL, r.activity_level)),
    row('Goal', goal),
    row('Diet', label(DIET_LABEL, r.diet_type)),
    row('Allergies and restrictions', restrictions(r.diet_restrictions)),
    row('Workout days', days === undefined ? undefined : `${days} per week`),
    row('Equipment', equipment),
  ];
}

/**
 * Daily targets. `current` is GET /me/macros/current (the coach's target, else
 * the server-computed profile target — the numbers the Food tab uses):
 * `undefined` = not read yet or the read failed, so the saved profile values
 * stand in; `null` = the server has no target. Rows without a value are left
 * out; an empty list means no target exists yet.
 */
export function buildTargetRows(
  current: MacroTarget | null | undefined,
  profile: ProfileValues | null | undefined,
): TargetRow[] {
  const p: ProfileValues = profile ?? {};
  const calories = current === undefined
    ? positive(p.macro_target_calories) ?? positive(p.calorie_target)
    : positive(current?.calories_kcal);
  const protein = current === undefined
    ? nonNegative(p.macro_target_protein_g) ?? nonNegative(p.protein_target)
    : nonNegative(current?.protein_g);
  const carbs = current === undefined
    ? nonNegative(p.macro_target_carbs_g) ?? nonNegative(p.carbs_target)
    : nonNegative(current?.carbs_g);
  const fat = current === undefined
    ? nonNegative(p.macro_target_fat_g) ?? nonNegative(p.fat_target)
    : nonNegative(current?.fats_g);
  if (calories === undefined) return [];
  const rows: TargetRow[] = [{ label: 'Calories', value: `${Math.round(calories)} kcal` }];
  if (protein !== undefined) rows.push({ label: 'Protein', value: `${Math.round(protein)} g` });
  if (carbs !== undefined) rows.push({ label: 'Carbs', value: `${Math.round(carbs)} g` });
  if (fat !== undefined) rows.push({ label: 'Fat', value: `${Math.round(fat)} g` });
  return rows;
}
