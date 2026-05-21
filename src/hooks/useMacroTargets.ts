import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { macrosApi } from '../api/macrosApi';
import { useCurrentUser } from './useCurrentUser';

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

// Legacy global key from before per-user scoping landed. Removed on first
// authenticated read so it can't leak across users on shared devices (P0-5).
const LEGACY_GLOBAL_CACHE_KEY = 'macro_targets';

function cacheKeyFor(userId: string): string {
  return `macro_targets:${userId}`;
}

/**
 * useMacroTargets — server-authoritative macro targets with AsyncStorage cache.
 *
 * Load order:
 *  1. Immediately read the AsyncStorage cache (scoped to the current user)
 *     so the UI shows data at once — no blank flash on mount.
 *  2. Fetch the current target from GET /me/macros/current so coach-set
 *     values always win over any locally-stored defaults.
 *  3. Persist the server response back to the per-user cache key so the next
 *     cold mount is still fast.
 *
 * Cross-user safety: the cache key is `macro_targets:${userId}`. When the
 * signed-in user changes (logout → login, account switch, or first mount
 * after restore) the hook re-runs against the new id and never paints the
 * previous user's macros. This matters on shared/gym-kiosk devices where
 * user A's coach-prescribed macros must not flash on user B's screen.
 */
export function useMacroTargets(): MacroTargets | null {
  const currentUser = useCurrentUser();
  const userId = currentUser?.id ?? null;
  const [macroTargets, setMacroTargets] = useState<MacroTargets | null>(null);

  useEffect(() => {
    // Reset state immediately on user change so the previous user's value
    // can't render for one frame while the new fetch is in flight (P0-5).
    setMacroTargets(null);

    if (!userId) {
      // No authenticated user → nothing to load.
      return;
    }

    let cancelled = false;
    const cacheKey = cacheKeyFor(userId);

    async function load() {
      // One-time cleanup: nuke the legacy global key on the way through so
      // stale cross-user data can't be revived by a future build that
      // accidentally reads it. Best-effort.
      try {
        await AsyncStorage.removeItem(LEGACY_GLOBAL_CACHE_KEY);
      } catch {
        // ignore — the leak is the only reason the key exists.
      }

      // Step 1 — warm the UI from the per-user cache.
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
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
            const raw = await AsyncStorage.getItem(cacheKey);
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
          await AsyncStorage.setItem(cacheKey, JSON.stringify(merged));
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
  }, [userId]);

  return macroTargets;
}
