import { createContext, useContext, useEffect, useRef, useState, type Context } from 'react';
import { AppState } from 'react-native';
import * as Navigation from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { macrosApi, type MacroTarget } from '../api/macrosApi';
import { useCurrentUser } from './useCurrentUser';
import { reportMacroDisplay } from '../macros/macroDisplayStore';

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

// TARGETS-REFRESH-M: one read of GET /me/macros/current at a time per account. The Food tab, Home and Progress each
// hold this hook, so a return to the app reads her target once for all of them; another account never joins it.
let shared: { userId: string; read: Promise<MacroTarget | null> } | null = null;
function readCurrent(userId: string): Promise<MacroTarget | null> {
  if (shared?.userId !== userId) {
    const read = macrosApi
      .currentForSelf()
      .then((res) => res.data)
      .finally(() => {
        if (shared?.read === read) shared = null;
      });
    shared = { userId, read };
  }
  return shared.read;
}

// The screen the hook is on (a test may mock navigation away; LogScreen.tsx:69 does the same).
const NO_SCREEN = createContext<unknown>(undefined);
const contextOf = (c: unknown) => (c as Context<unknown> | undefined) ?? NO_SCREEN;
type FocusEvents = { addListener?: (event: 'focus', listener: () => void) => () => void };

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
 *  4. Read the server again when she returns to the app from the background and
 *     when her screen (the Food tab, Home) gains focus, so a target her coach
 *     changed shows without a restart (TARGETS-REFRESH-M). One read per return,
 *     shared by every mounted reader; a failed read keeps the target on screen.
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
  const screen = useContext(contextOf(Navigation.NavigationContext)) as FocusEvents | undefined;
  const readAgain = useRef<() => void>(() => undefined);

  useEffect(() => {
    // Reset state immediately on user change so the previous user's value
    // can't render for one frame while the new fetch is in flight (P0-5).
    setMacroTargets(null);

    if (!userId) {
      // No authenticated user → nothing to load.
      return;
    }

    let cancelled = false;
    const owner = userId;
    const cacheKey = cacheKeyFor(owner);
    let latest = 0; // the newest read; an older answer never paints over it

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

      await readServer();
    }

    async function readServer() {
      // Step 2 — fetch authoritative values from the server.
      const mine = ++latest;
      try {
        const serverTarget = await readCurrent(owner);
        if (cancelled || mine !== latest) return;
        // Lighter start for never-trackers: the same body carries
        // macro_display_mode / simple_until. Absent means 'full'.
        reportMacroDisplay(serverTarget);

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

          if (cancelled || mine !== latest) return;
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
    readAgain.current = () => void readServer();
    // Step 4 — a return to the app from the background reads again; a glance at Control Centre or the app switcher
    // (inactive and back) is not a return (the useServerCoachRefresh.ts pattern).
    let away = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') away = true;
      if (state !== 'active' || !away) return;
      away = false;
      void readServer();
    });
    return () => {
      cancelled = true;
      readAgain.current = () => undefined;
      sub.remove();
    };
  }, [userId]);

  // Step 4 — her screen gaining focus (back to the Food tab or Home) reads again too.
  useEffect(() => screen?.addListener?.('focus', () => readAgain.current()), [screen]);

  return macroTargets;
}
