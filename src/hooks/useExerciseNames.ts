/**
 * Resolve catalog exercise ids to display names (UX-WORKOUT-124).
 *
 * Coach-assigned plans store only `exercise_external_id`. One cached
 * GET /exercises/:id per distinct id (same key as useExerciseById, so the
 * Exercise Detail screen reuses the result). A failed lookup is simply
 * absent from the map; callers fall back to a prettified id.
 *
 * `loading` is true while any lookup is still in flight (not when it has
 * failed, and not when it is paused offline), so a caller can wait for the
 * names before copying them into a live workout.
 */
import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { exerciseLibraryApi, type Exercise } from '../api/exerciseLibraryApi';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/** Title-case a catalog name ("barbell bench press" -> "Barbell Bench Press"). */
export function displayExerciseName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export interface ExerciseNames {
  names: Record<string, string>;
  loading: boolean;
}

export function useExerciseNames(ids: string[]): ExerciseNames {
  const unique = useMemo(
    () => Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))),
    [ids],
  );
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: ['exercises', 'by-id', id],
      queryFn: () => exerciseLibraryApi.getById(id).then((r) => r.data as Exercise),
      staleTime: FIFTEEN_MIN_MS,
      retry: 1,
    })),
  });
  const joined = results.map((r) => r.data?.name ?? '').join('\u0000');
  const loading = results.some((r) => r.isPending && r.fetchStatus === 'fetching');
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    const list = joined.split('\u0000');
    unique.forEach((id, i) => {
      const n = list[i];
      if (n) out[id] = displayExerciseName(n);
    });
    return out;
  }, [unique, joined]);
  return { names, loading };
}
