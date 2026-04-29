/**
 * usePreferences — UX Psychology Report #4 "Preference-Controlled Personalization"
 *
 * Fetches, caches, and mutates the user's personalization preferences.
 * Falls back to safe defaults if the user is unauthenticated (401) or the
 * network call fails.
 *
 * Usage:
 *   const { prefs, isLoading, updatePrefs } = usePreferences();
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { preferencesApi } from '../services/api';
import { errorStatus } from '../types/common';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HomeModule = 'hero' | 'milestone' | 'trustcues' | 'secondary' | 'community';
export type NotificationCadence = 'daily' | 'weekly' | 'off';
export type MotivationalTone = 'gentle' | 'direct' | 'drill';
export type Units = 'metric' | 'imperial';
export type FirstDayOfWeek = 0 | 1 | 6; // 0=Sun, 1=Mon, 6=Sat

export interface UserPreferences {
  homeModules: HomeModule[];
  notificationCadence: NotificationCadence;
  motivationalTone: MotivationalTone;
  units: Units;
  firstDayOfWeek: FirstDayOfWeek;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_PREFERENCES: UserPreferences = {
  homeModules: ['hero', 'milestone', 'trustcues', 'secondary'],
  notificationCadence: 'daily',
  motivationalTone: 'direct',
  units: 'imperial',
  firstDayOfWeek: 1,
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchPreferences(): Promise<UserPreferences> {
  try {
    const res = await preferencesApi.get();
    const data = res.data ?? res;
    // Merge with defaults to handle missing fields gracefully
    return { ...DEFAULT_PREFERENCES, ...data };
  } catch (err) {
    // 401/403 = unauthenticated → return defaults silently. We log nothing
    // because the screen is rendered before the user is forced through auth
    // and noisy console output here masks real failures elsewhere.
    const status = errorStatus(err);
    if (status === 401 || status === 403) {
      return { ...DEFAULT_PREFERENCES };
    }
    return { ...DEFAULT_PREFERENCES };
  }
}

async function patchPreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
  const res = await preferencesApi.patch(patch as Record<string, unknown>);
  const data = res.data ?? res;
  return { ...DEFAULT_PREFERENCES, ...data };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePreferences() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<UserPreferences>({
    queryKey: ['user', 'preferences'],
    queryFn: fetchPreferences,
    staleTime: 5 * 60_000,   // 5 min
    retry: 1,
  });

  const mutation = useMutation<UserPreferences, Error, Partial<UserPreferences>>({
    mutationFn: patchPreferences,
    onMutate: async (patch) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ['user', 'preferences'] });
      const prev = queryClient.getQueryData<UserPreferences>(['user', 'preferences']);
      queryClient.setQueryData<UserPreferences>(['user', 'preferences'], (old) => ({
        ...(old ?? DEFAULT_PREFERENCES),
        ...patch,
      }));
      return prev;
    },
    onError: (_err, _patch, context) => {
      // Roll back on error
      if (context) {
        queryClient.setQueryData<UserPreferences>(['user', 'preferences'], context as UserPreferences);
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<UserPreferences>(['user', 'preferences'], updated);
    },
  });

  const prefs: UserPreferences = data ?? DEFAULT_PREFERENCES;

  /** Merge a partial update and persist to the backend */
  const updatePrefs = (patch: Partial<UserPreferences>) => {
    mutation.mutate(patch);
  };

  return {
    prefs,
    isLoading: isLoading && !data,
    isError,
    isSaving: mutation.isPending,
    updatePrefs,
  };
}
