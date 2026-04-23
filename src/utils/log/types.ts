import { MealType } from '../../types';

export interface SearchResult {
  id?: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size?: string;
  brand?: string | null;
  image_url?: string | null;
}

export const MEAL_SECTIONS: { type: MealType; label: string; icon: string }[] = [
  { type: 'breakfast', label: 'Breakfast', icon: 'sunny-outline' },
  { type: 'lunch', label: 'Lunch', icon: 'restaurant-outline' },
  { type: 'dinner', label: 'Dinner', icon: 'moon-outline' },
  { type: 'snack', label: 'Snacks', icon: 'cafe-outline' },
];

export const UNIT_OPTIONS = ['serving', 'g', 'oz', 'cup', 'tbsp', 'tsp'];
