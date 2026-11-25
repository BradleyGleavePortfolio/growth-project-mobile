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
import { bodyWeightMap, byIdQuery, uniqueIds } from './exerciseByIdQuery';
import { isPhoneMadeId } from '../utils/workout/exerciseId';

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
  /** FIX-928-BW: ids whose catalog equipment is body weight (true), from the same read. */
  bodyWeight: Record<string, boolean>;
}

export function useExerciseNames(ids: string[]): ExerciseNames {
  const unique = useMemo(() => uniqueIds(ids), [ids]);
  const results = useQueries({ queries: unique.map(byIdQuery) });
  const joined = results.map((r) => r.data?.name ?? '').join('\u0000');
  // LS-928 B2: never wait on an id the phone made; the catalog cannot answer it
  // (one read, no retry), so a caller copying names does not hold for it.
  const loading = results.some((r, i) => !isPhoneMadeId(unique[i]) && r.isPending && r.fetchStatus === 'fetching');
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    const list = joined.split('\u0000');
    unique.forEach((id, i) => {
      const n = list[i];
      if (n) out[id] = displayExerciseName(n);
    });
    return out;
  }, [unique, joined]);
  return { names, loading, bodyWeight: bodyWeightMap(unique, results) };
}
