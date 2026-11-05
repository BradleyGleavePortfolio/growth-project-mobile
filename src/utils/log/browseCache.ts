// OFFLINE-FOOD-M (owner #191-E3): the add sheet's Recent, Frequent and Repeat lists, kept on this
// phone after each good read so they are there with no signal. One copy per member (keyed by their
// id, so another account on the phone never sees it), removed at sign-out (authActions
// PER_USER_KEY_PREFIXES), capped at BROWSE_COPY_CAP so it stays small.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MealType } from '../../types';
import type { SearchResult } from './types';
import type { PastMeal } from '../../hooks/useFoodBrowse';
import { logger } from '../logger';

export const BROWSE_COPY_KEY_PREFIX = 'food_browse_copy_';
export const browseCopyKey = (userId: string) => `${BROWSE_COPY_KEY_PREFIX}${userId}`;

/** At most 12 Recent and 12 Frequent foods (the sheet's own limit) and 20 foods per Repeat meal. */
export const BROWSE_COPY_CAP = { foods: 12, foodsPerMeal: 20 } as const;

export interface BrowseCopy {
  /** The day the lists were read for: Repeat meals are earlier days than this. */
  readFor: string;
  recentFoods: SearchResult[];
  frequentFoods: SearchResult[];
  lastMeals: Partial<Record<MealType, PastMeal>>;
}

function capped(copy: BrowseCopy): BrowseCopy {
  const lastMeals: Partial<Record<MealType, PastMeal>> = {};
  for (const [meal, past] of Object.entries(copy.lastMeals) as [MealType, PastMeal | undefined][]) {
    if (past) lastMeals[meal] = { ...past, entries: past.entries.slice(0, BROWSE_COPY_CAP.foodsPerMeal) };
  }
  return {
    readFor: copy.readFor,
    recentFoods: copy.recentFoods.slice(0, BROWSE_COPY_CAP.foods),
    frequentFoods: copy.frequentFoods.slice(0, BROWSE_COPY_CAP.foods),
    lastMeals,
  };
}

export async function keepBrowseCopy(userId: string, copy: BrowseCopy): Promise<void> {
  try {
    await AsyncStorage.setItem(browseCopyKey(userId), JSON.stringify(capped(copy)));
  } catch (err) {
    logger.warn('BrowseCopy', 'keep failed', err);
  }
}

export async function readBrowseCopy(userId: string): Promise<BrowseCopy | null> {
  try {
    const raw = await AsyncStorage.getItem(browseCopyKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrowseCopy;
    if (!parsed || !Array.isArray(parsed.recentFoods) || !Array.isArray(parsed.frequentFoods)) return null;
    return { ...parsed, lastMeals: parsed.lastMeals && typeof parsed.lastMeals === 'object' ? parsed.lastMeals : {} };
  } catch (err) {
    logger.warn('BrowseCopy', 'read failed', err);
    return null;
  }
}

/** The kept Repeat meals that are still earlier than the day on screen. */
export function earlierMeals(meals: BrowseCopy['lastMeals'], selectedDate: string): BrowseCopy['lastMeals'] {
  const out: BrowseCopy['lastMeals'] = {};
  for (const [meal, past] of Object.entries(meals) as [MealType, PastMeal | undefined][]) {
    if (past && Array.isArray(past.entries) && past.date < selectedDate) out[meal] = past;
  }
  return out;
}
