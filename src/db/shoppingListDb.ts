import AsyncStorage from '@react-native-async-storage/async-storage';
import { ShoppingItem } from '../types';
import { generateId } from '../utils/date';
import { getMealPlan, parsePlanData } from './mealPlanDb';
import { getAllRecipes } from './recipesDb';

function storageKey(userId: string, weekStart: string): string {
  return `shopping_${userId}_${weekStart}`;
}

export async function getShoppingList(
  userId: string,
  weekStart: string
): Promise<ShoppingItem[]> {
  const raw = await AsyncStorage.getItem(storageKey(userId, weekStart));
  if (!raw) return [];
  return JSON.parse(raw);
}

export async function saveShoppingList(
  userId: string,
  weekStart: string,
  items: ShoppingItem[]
): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId, weekStart), JSON.stringify(items));
}

function categorizeIngredient(ingredient: string): string {
  const lower = ingredient.toLowerCase();
  if (/chicken|beef|turkey|salmon|shrimp|tuna|steak|pork|bacon|ham|cod|tilapia|fish/.test(lower))
    return 'Protein';
  if (/milk|yogurt|cheese|butter|cream|feta|mozzarella|parmesan/.test(lower))
    return 'Dairy';
  if (/bread|tortilla|naan|pita|bagel|muffin|bun|crouton|rice|pasta|noodle|oat|quinoa|couscous|lentil|bean/.test(lower))
    return 'Grains & Legumes';
  if (/apple|banana|orange|berries|blueberr|strawberr|mango|lime|lemon|pear|grape|avocado/.test(lower))
    return 'Fruits';
  if (/broccoli|spinach|kale|pepper|onion|garlic|tomato|cucumber|carrot|celery|zucchini|mushroom|asparagus|lettuce|cabbage|corn|peas|bok choy|bean sprout|potato|sweet potato/.test(lower))
    return 'Vegetables';
  if (/olive oil|sesame oil|soy sauce|vinegar|mayo|mustard|sriracha|hot sauce|bbq|teriyaki|marinara|salsa|hoisin|fish sauce|balsamic/.test(lower))
    return 'Condiments';
  if (/almond|cashew|walnut|peanut butter|pumpkin seed|chia|granola|chocolate|honey|cocoa/.test(lower))
    return 'Nuts & Seeds';
  if (/cumin|paprika|oregano|basil|cilantro|dill|ginger|cinnamon|turmeric|curry|italian|chili|vanilla|salt|pepper|baking|protein powder|whey/.test(lower))
    return 'Spices & Other';
  return 'Other';
}

export async function generateShoppingListFromPlan(
  userId: string,
  weekStart: string
): Promise<ShoppingItem[]> {
  const plan = await getMealPlan(userId, weekStart);
  if (!plan) return [];

  const planData = parsePlanData(plan.planData);
  const allRecipes = await getAllRecipes();
  const recipeMap = new Map(allRecipes.map((r) => [r.name, r]));

  const ingredientSet = new Map<string, string>();

  for (const dateKey of Object.keys(planData)) {
    const day = planData[dateKey];
    const slots = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
    for (const slot of slots) {
      const meal = day[slot];
      if (!meal) continue;
      const recipe = recipeMap.get(meal.name);
      if (!recipe) continue;
      try {
        const ingredients: string[] = JSON.parse(recipe.ingredients);
        for (const ing of ingredients) {
          if (!ingredientSet.has(ing.toLowerCase())) {
            ingredientSet.set(ing.toLowerCase(), ing);
          }
        }
      } catch {}
    }
  }

  const items: ShoppingItem[] = [];
  for (const [, original] of ingredientSet) {
    items.push({
      id: generateId(),
      name: original,
      category: categorizeIngredient(original),
      checked: false,
    });
  }

  items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  await saveShoppingList(userId, weekStart, items);
  return items;
}
