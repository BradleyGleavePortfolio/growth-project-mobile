import api from '../services/api';

export interface RecordedFoodEntry {
  id: string;
  date: string;
  meal_type: string;
  quantity_multiplier: number;
  original_quantity?: number | null;
  original_unit?: string | null;
  notes?: string | null;
  food_item: {
    name: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
}

interface FoodTimelinePage {
  meals?: RecordedFoodEntry[];
  consent?: { food_macros?: boolean };
  error?: string;
}

export class FoodReviewUnavailableError extends Error {}

// The timeline returns at most 100 entries per slice, with mealsCursor
// supported by the existing controller. A 30-day review routinely exceeds
// one page; never present that first page as the complete food history.
// Servers that sort the meals slice by eat date only can repeat the
// boundary day's entries on the next page, so each entry id is kept once.
export async function loadCoachFoodReview(clientId: string, days: 7 | 14 | 30) {
  const meals: RecordedFoodEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ days: String(days) });
    if (cursor) query.set('mealsCursor', cursor);
    const { data } = await api.get<FoodTimelinePage>(
      `/coach/clients/${clientId}/timeline?${query.toString()}`,
    );
    if (data.error) {
      throw new FoodReviewUnavailableError('This client is not available. Return to Clients and select a current client.');
    }
    if (data.consent?.food_macros === false) {
      return { meals: [], shared: false };
    }
    if (!Array.isArray(data.meals)) {
      throw new FoodReviewUnavailableError('Food logs were not returned. Refresh to load the client’s recorded meals.');
    }
    for (const entry of data.meals) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      meals.push(entry);
    }
    if (data.meals.length < 100) return { meals, shared: true };
    // Page from the last raw row, even when it was a repeat.
    cursor = data.meals[data.meals.length - 1].id;
  }
}
