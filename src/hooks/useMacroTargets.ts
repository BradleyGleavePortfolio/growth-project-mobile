import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { macrosApi } from '../api/macrosApi';

export interface MacroTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Extra fields forwarded from profile / onboarding cache. */
  goalWeight?: number;
  height?: number;
  tdee?: number;
}

const CACHE_KEY = 'macro_targets';

/**
 * useMacroTargets — server-authoritative macro targets with AsyncStorage cache.
 *
 * Load order:
 *  1. Immediately read the AsyncStorage cache so the UI shows data at once
 *     (no blank flash on mount).
 *  2. Fetch the current target from GET /me/macros/current so coach-set
 *     values always win over any locally-stored defaults.
 *  3. Persist the server response back to AsyncStorage so the next cold
 *     mount is still fast.
 *
 * If the server call fails the cached value remains in state — the user
 * sees potentially-stale data rather than a blank screen.
 */
export function useMacroTargets(): MacroTargets | null {
  const [macroTargets, setMacroTargets] = useState<MacroTargets | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Step 1 — warm the UI from cache immediately.
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw && !cancelled) {
          setMacroTargets(JSON.parse(raw));
        }
      } catch (err) {
        console.error('useMacroTargets: failed to read cache', err);
      }

      // Step 2 — fetch authoritative values from the server.
      try {
        const res = await macrosApi.currentForSelf();
        const serverTarget = res.data;
        if (cancelled) return;

        if (serverTarget) {
          // Map server field names (calories_kcal / fats_g) to the shape
          // the UI already expects (calories / fat).
          const merged: MacroTargets = {
            calories: serverTarget.calories_kcal,
            protein: serverTarget.protein_g,
            carbs: serverTarget.carbs_g,
            fat: serverTarget.fats_g,
          };

          // Preserve profile-only fields (goalWeight, height, tdee) from the
          // existing cache so we don't lose them when the server target is null
          // for those fields.
          try {
            const raw = await AsyncStorage.getItem(CACHE_KEY);
            if (raw) {
              const cached: MacroTargets = JSON.parse(raw);
              if (cached.goalWeight != null) merged.goalWeight = cached.goalWeight;
              if (cached.height != null) merged.height = cached.height;
              if (cached.tdee != null) merged.tdee = cached.tdee;
            }
          } catch {
            // ignore — profile fields are nice-to-have
          }

          setMacroTargets(merged);

          // Step 3 — update the cache with the latest server value.
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(merged));
        }
        // If serverTarget is null (no coach-set target yet), keep whatever
        // the cache provided — could be onboarding-derived defaults.
      } catch (err) {
        // Network / auth failure: cached value already in state, no change.
        console.warn('useMacroTargets: server fetch failed, using cache', err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return macroTargets;
}
