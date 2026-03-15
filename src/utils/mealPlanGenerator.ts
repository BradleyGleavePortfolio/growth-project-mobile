import { ClientProfile, Recipe } from '../types';
import { getAllRecipes, getAllFoods } from '../db/recipesDb';
import { PlanData, PlanDay, PlanDayMeal } from '../db/mealPlanDb';

interface MealOption {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tags: string[];
}

function parseTagsOrPrefs(jsonStr: string | undefined): string[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getMealCategoryTag(slot: 'breakfast' | 'lunch' | 'dinner' | 'snacks'): string {
  switch (slot) {
    case 'breakfast': return 'breakfast';
    case 'lunch': return 'lunch';
    case 'dinner': return 'dinner';
    case 'snacks': return 'snack';
  }
}

function matchesRestrictions(meal: MealOption, restrictions: string[]): boolean {
  if (restrictions.length === 0) return true;
  const nameLower = meal.name.toLowerCase();
  const tagsLower = meal.tags.map(t => t.toLowerCase());

  for (const restriction of restrictions) {
    const r = restriction.toLowerCase();
    if (r.includes('vegetarian') || r.includes('vegan')) {
      const meatKeywords = ['chicken', 'beef', 'turkey', 'salmon', 'tuna', 'shrimp', 'steak', 'cod', 'pork', 'bacon', 'ham', 'fish', 'tilapia', 'meat'];
      if (meatKeywords.some(k => nameLower.includes(k))) return false;
    }
    if (r.includes('no beef') || r.includes('no red meat')) {
      if (nameLower.includes('beef') || nameLower.includes('steak') || nameLower.includes('burger')) return false;
    }
    if (r.includes('no dairy') || r.includes('dairy free') || r.includes('lactose')) {
      if (nameLower.includes('cheese') || nameLower.includes('yogurt') || nameLower.includes('cream') || nameLower.includes('milk')) return false;
    }
    if (r.includes('no gluten') || r.includes('gluten free')) {
      if (nameLower.includes('bread') || nameLower.includes('pasta') || nameLower.includes('tortilla') || nameLower.includes('noodle') || nameLower.includes('bagel')) return false;
    }
  }
  return true;
}

function scoreMeal(
  meal: MealOption,
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snacks',
  targetCalories: number,
  profile: ClientProfile | null,
  usedNames: Set<string>,
): number {
  let score = 0;
  const slotTag = getMealCategoryTag(slot);

  // Prefer meals tagged for this slot
  if (meal.tags.some(t => t.toLowerCase() === slotTag)) score += 20;

  // Penalize reuse of same meal
  if (usedNames.has(meal.name)) score -= 30;

  // Calorie proximity
  const calDiff = Math.abs(meal.calories - targetCalories);
  score -= calDiff * 0.05;

  // Protein preference for goals
  if (profile?.primaryGoal === 'lose_fast' || profile?.primaryGoal === 'lose_moderate') {
    if (meal.tags.some(t => t.includes('high-protein'))) score += 10;
    if (meal.tags.some(t => t.includes('low-carb'))) score += 5;
  }

  // Diet type preferences
  if (profile?.dietType) {
    const diet = profile.dietType.toLowerCase();
    if (diet.includes('vegetarian') && meal.tags.some(t => t.includes('vegetarian'))) score += 10;
    if (diet.includes('low-carb') && meal.tags.some(t => t.includes('low-carb'))) score += 10;
  }

  // Quick meals get a small bonus for lunch
  if (slot === 'lunch' && meal.tags.some(t => t.includes('quick'))) score += 5;

  // Add some randomness for variety
  score += Math.random() * 10;

  return score;
}

function pickBestMeal(
  meals: MealOption[],
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snacks',
  targetCalories: number,
  profile: ClientProfile | null,
  restrictions: string[],
  usedNames: Set<string>,
): MealOption | null {
  const eligible = meals.filter(m => matchesRestrictions(m, restrictions));
  if (eligible.length === 0) return null;

  const scored = eligible.map(m => ({
    meal: m,
    score: scoreMeal(m, slot, targetCalories, profile, usedNames),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Pick from top 3 for variety
  const topN = scored.slice(0, Math.min(3, scored.length));
  const pick = topN[Math.floor(Math.random() * topN.length)];
  return pick.meal;
}

export async function generateWeeklyMealPlan(
  profile: ClientProfile | null,
  weekDates: string[],
): Promise<PlanData> {
  const [recipes, foods] = await Promise.all([getAllRecipes(), getAllFoods()]);

  const allMeals: MealOption[] = [
    ...recipes.map(r => ({
      name: r.name,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      tags: parseTagsOrPrefs(r.tags),
    })),
    ...foods.filter(f => f.calories >= 100).map(f => ({
      name: f.name,
      calories: f.calories,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      tags: ['food'],
    })),
  ];

  const dailyCal = profile?.calorieTarget || 2000;
  const restrictions = parseTagsOrPrefs(profile?.restrictions);

  // Distribute calories across meals: 25% breakfast, 35% lunch, 30% dinner, 10% snacks
  const calorieAlloc = {
    breakfast: Math.round(dailyCal * 0.25),
    lunch: Math.round(dailyCal * 0.35),
    dinner: Math.round(dailyCal * 0.30),
    snacks: Math.round(dailyCal * 0.10),
  };

  const planData: PlanData = {};
  const globalUsed = new Set<string>();

  for (const date of weekDates) {
    const dayUsed = new Set<string>();
    const day: PlanDay = { breakfast: null, lunch: null, dinner: null, snacks: null };

    const slots: ('breakfast' | 'lunch' | 'dinner' | 'snacks')[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

    for (const slot of slots) {
      const meal = pickBestMeal(
        allMeals,
        slot,
        calorieAlloc[slot],
        profile,
        restrictions,
        new Set([...globalUsed, ...dayUsed]),
      );

      if (meal) {
        day[slot] = { name: meal.name, calories: meal.calories };
        dayUsed.add(meal.name);
        globalUsed.add(meal.name);
      }
    }

    planData[date] = day;

    // Reset global used every 3 days to allow some repeats in a week
    if (weekDates.indexOf(date) === 2) {
      globalUsed.clear();
    }
  }

  return planData;
}

export function getCalorieDistribution(profile: ClientProfile | null): {
  breakfast: number;
  lunch: number;
  dinner: number;
  snacks: number;
} {
  const dailyCal = profile?.calorieTarget || 2000;
  return {
    breakfast: Math.round(dailyCal * 0.25),
    lunch: Math.round(dailyCal * 0.35),
    dinner: Math.round(dailyCal * 0.30),
    snacks: Math.round(dailyCal * 0.10),
  };
}
