const ACT_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENTS: Record<string, number> = {
  lose_fast: -750,
  lose_moderate: -500,
  maintain: 0,
  gain: 350,
  gain_fast: 700,
  mobility: 0,
};

export function calcBMR(
  weightLbs: number,
  heightCm: number,
  age: number,
  sex: 'male' | 'female'
): number {
  const kg = weightLbs * 0.453592;
  return sex === 'male'
    ? 10 * kg + 6.25 * heightCm - 5 * age + 5
    : 10 * kg + 6.25 * heightCm - 5 * age - 161;
}

export function calcTDEE(bmr: number, activityLevel: string): number {
  return Math.round(bmr * (ACT_MULTIPLIERS[activityLevel] || 1.375));
}

export function calcMacros(
  weightLbs: number,
  tdee: number,
  goal: string
): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tdee: number;
  adjustment: number;
} {
  const adj = GOAL_ADJUSTMENTS[goal] || 0;
  const cals = Math.max(1200, tdee + adj);
  const protein = Math.round(weightLbs * 0.85);
  const fat = Math.round((cals * 0.25) / 9);
  const carbs = Math.max(0, Math.round((cals - protein * 4 - fat * 9) / 4));
  return { calories: cals, protein, carbs, fat, tdee, adjustment: adj };
}

export function heightToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { feet, inches };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}

export function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}
