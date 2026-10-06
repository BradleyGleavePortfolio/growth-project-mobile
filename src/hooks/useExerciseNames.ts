/**
 * Resolve catalog exercise ids to display names (UX-WORKOUT-124).
 *
 * Coach-assigned plans store only `exercise_external_id`. One cached
 * GET /exercises/:id per distinct id (same key as useExerciseById, so the
 * Exercise Detail screen reuses the result). A failed lookup is simply
 * absent from the map; callers fall back to a prettified id.
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

export function useExerciseNames(ids: string[]): Record<string, string> {
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
  const names = results.map((r) => r.data?.name ?? '').join('\u0000');
  return useMemo(() => {
    const out: Record<string, string> = {};
    const list = names.split('\u0000');
    unique.forEach((id, i) => {
      const n = list[i];
      if (n) out[id] = displayExerciseName(n);
    });
    return out;
  }, [unique, names]);
}
