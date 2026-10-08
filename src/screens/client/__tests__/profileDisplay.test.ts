import { buildProfileRows, buildTargetRows, type ProfileValues } from '../profileDisplay';
import type { MacroTarget } from '../../../api/macrosApi';

const values = (profile?: ProfileValues) => Object.fromEntries(
  buildProfileRows({ name: 'Client', email: 'client@example.test' }, profile).map((row) => [row.label, row.value]),
);
const target: MacroTarget = {
  id: 'target', client_id: 'client', coach_id: 'coach', calories_kcal: 2200,
  protein_g: 145, carbs_g: 260, fats_g: 65, fiber_g: null, notes: null,
  effective_from: '2026-10-07', created_at: '2026-10-07', archived_at: null,
};

it('prints saved server fields with honest labels and units instead of raw enums', () => {
  expect(values({
    sex: 'prefer_not_to_say', date_of_birth: '1990-05-12T00:00:00.000Z',
    height_cm: 180, current_weight_lbs: 175, target_weight_lbs: 165,
    activity_level: 'moderate', goal_type: 'fat_loss', dietary_pattern: 'none',
    dietary_restrictions: ['nut_allergy', 'gluten_free'], workout_days_per_week: 3,
    has_gym_membership: true,
  })).toEqual({
    Name: 'Client', Email: 'client@example.test', Sex: 'Prefer not to say', 'Date of birth': 'May 12, 1990',
    Height: '180 cm', 'Current weight': '175 lbs', 'Target weight': '165 lbs',
    'Activity level': 'Moderately active', Goal: 'Lose weight', Diet: 'Omnivore',
    'Allergies and restrictions': 'Nut allergy, Gluten free', 'Workout days': '3 per week', Equipment: 'Gym access',
  });
});

it('preserves legacy answers, including an explicit no-restrictions answer', () => {
  const legacy = values({
    dob: '1992-04-15', current_weight: 180, target_weight: 165,
    primary_goal: 'lose_fast', diet_type: 'mediterranean', diet_restrictions: [],
    gym_membership: 'home_gym', activity_level: 'light',
  });
  expect(legacy).toMatchObject({
    'Date of birth': 'April 15, 1992', 'Current weight': '180 lbs', 'Target weight': '165 lbs',
    Goal: 'Lose weight fast', Diet: 'Mediterranean', Equipment: 'Home setup',
    'Allergies and restrictions': 'None', 'Activity level': 'Lightly active',
  });
});

it('does not invent gym access or a restrictions answer', () => {
  expect(values({ has_gym_membership: false, dietary_restrictions: [] })).toMatchObject({
    Equipment: 'No gym membership', 'Allergies and restrictions': 'Not set',
  });
  const missing = buildProfileRows(null, null);
  expect(missing.find((row) => row.label === 'Sex')).toEqual({ label: 'Sex', value: 'Not set', missing: true });
});

it('uses current targets first and treats confirmed null as no targets', () => {
  const profile = { macro_target_calories: 1800, calorie_target: 1200, protein_target: 100 };
  expect(buildTargetRows(target, profile)).toEqual([
    { label: 'Calories', value: '2200 kcal' }, { label: 'Protein', value: '145 g' },
    { label: 'Carbs', value: '260 g' }, { label: 'Fat', value: '65 g' },
  ]);
  expect(buildTargetRows(null, profile)).toEqual([]);
});

it('falls back to saved server targets, then legacy values, only while the current target is unknown', () => {
  expect(buildTargetRows(undefined, {
    macro_target_calories: 1800, macro_target_protein_g: 125, macro_target_carbs_g: 200, macro_target_fat_g: 55,
    calorie_target: 1200, protein_target: 100,
  })).toEqual([
    { label: 'Calories', value: '1800 kcal' }, { label: 'Protein', value: '125 g' },
    { label: 'Carbs', value: '200 g' }, { label: 'Fat', value: '55 g' },
  ]);
  expect(buildTargetRows(undefined, { calorie_target: 1900, protein_target: 120 })).toEqual([
    { label: 'Calories', value: '1900 kcal' }, { label: 'Protein', value: '120 g' },
  ]);
  expect(buildTargetRows(undefined, {})).toEqual([]);
});

it('keeps explicitly saved zero gram targets visible', () => {
  expect(buildTargetRows({ ...target, carbs_g: 0, fats_g: 0 }, {})).toEqual([
    { label: 'Calories', value: '2200 kcal' }, { label: 'Protein', value: '145 g' },
    { label: 'Carbs', value: '0 g' }, { label: 'Fat', value: '0 g' },
  ]);
});
