import { useState, useCallback } from 'react';
import { logApi } from '../services/api';
import { SearchResult } from '../utils/log/types';
import { mapLogEntryToFood, RawLogEntry } from '../utils/log/mapFoodItem';
import { bucketDateLocal } from '../utils/date';

export function useFoodBrowse(currentUserId: string | undefined, selectedDate: string) {
  const [recentFoods, setRecentFoods] = useState<SearchResult[]>([]);
  const [frequentFoods, setFrequentFoods] = useState<SearchResult[]>([]);

  const loadRecentFoods = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const res = await logApi.getDaily(selectedDate);
      const entries: RawLogEntry[] = res.data?.entries || [];
      const seen = new Set<string>();
      const recent: SearchResult[] = [];
      for (const e of entries) {
        const food = mapLogEntryToFood(e);
        if (food && !seen.has(food.name)) {
          seen.add(food.name);
          recent.push(food);
        }
      }
      setRecentFoods(recent.slice(0, 8));
    } catch (err) {
      console.error('useFoodBrowse: loadRecentFoods failed', err);
      setRecentFoods([]);
    }
  }, [currentUserId, selectedDate]);

  // Round-2 change: the 7 daily fetches used to run sequentially (~7 × 500ms on
  // LTE = 3.5s before the list appeared). Now they fire in parallel via
  // Promise.allSettled; cold-start time for the browse tab drops to a single
  // round-trip plus a bit of fan-in. `allSettled` keeps one bad day from
  // nuking the rest of the aggregate.
  const loadFrequentFoods = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const today = new Date(selectedDate);
      const dateStrings: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dateStrings.push(bucketDateLocal(d));
      }
      const settled = await Promise.allSettled(dateStrings.map((ds) => logApi.getDaily(ds)));
      const foodCount: Record<string, { count: number; food: SearchResult }> = {};
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        const entries: RawLogEntry[] = result.value.data?.entries || [];
        for (const e of entries) {
          const food = mapLogEntryToFood(e);
          if (!food) continue;
          if (!foodCount[food.name]) {
            foodCount[food.name] = { count: 0, food };
          }
          foodCount[food.name].count++;
        }
      }
      const sorted = Object.values(foodCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((item) => item.food);
      setFrequentFoods(sorted);
    } catch (err) {
      console.error('useFoodBrowse: loadFrequentFoods failed', err);
      setFrequentFoods([]);
    }
  }, [currentUserId, selectedDate]);

  return { recentFoods, frequentFoods, loadRecentFoods, loadFrequentFoods };
}
