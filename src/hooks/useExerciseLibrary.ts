/**
 * useExerciseLibrary — React Query hooks over exerciseLibraryApi.
 *
 * Read-only proxy to the ExerciseDB catalog (or the in-process seed
 * catalog when EXERCISEDB_API_KEY is unset on the backend). Search
 * is paginated by an opaque cursor; consumers can extend to infinite
 * scroll with `useInfiniteQuery` in a later PR. For v1 we expose the
 * simple `useQuery` form.
 *
 * Query keys:
 *   ['exercises', 'search', JSON(params)] — search results page
 *   ['exercises', 'by-id', id]            — single exercise
 *
 * 15-minute staleTime — the upstream catalog rarely changes and the
 * backend caches 5 minutes locally so a longer client-side stale is
 * safe.
 */

import { useQuery } from '@tanstack/react-query';
import {
  exerciseLibraryApi,
  type Exercise,
  type ExerciseSearchParams,
  type ExerciseSearchResult,
} from '../api/exerciseLibraryApi';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export function useExerciseSearch(
  params: ExerciseSearchParams,
  options: { enabled?: boolean } = {},
) {
  return useQuery<ExerciseSearchResult>({
    queryKey: ['exercises', 'search', JSON.stringify(params)],
    queryFn: () => exerciseLibraryApi.search(params).then((r) => r.data),
    enabled: options.enabled !== false,
    staleTime: FIFTEEN_MIN_MS,
  });
}

export function useExerciseById(id: string | undefined) {
  return useQuery<Exercise>({
    queryKey: ['exercises', 'by-id', id],
    queryFn: () =>
      exerciseLibraryApi.getById(id as string).then((r) => r.data),
    enabled: !!id,
    staleTime: FIFTEEN_MIN_MS,
  });
}
