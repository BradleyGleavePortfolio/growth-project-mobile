/**
 * exerciseLibraryApi — typed client for the backend exercise library endpoints.
 *
 * All requests are proxied through the Growth Project backend, which holds
 * the ExerciseDB API key. The mobile client never contacts ExerciseDB directly.
 *
 * Endpoints:
 *   GET /exercises/search   — paginated search with optional filters
 *   GET /exercises/:id      — single exercise by catalog id
 */

import api from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Exercise {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  secondaryMuscles: string[];
  instructions: string[];
  gifUrl: string;
}

export interface ExerciseSearchResult {
  items: Exercise[];
  /** Opaque cursor; null when the last page is reached. */
  nextCursor: string | null;
  total: number;
}

export interface ExerciseSearchParams {
  q?: string;
  muscleGroup?: string;
  equipment?: string;
  limit?: number;
  cursor?: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Search the exercise catalog.
 *
 * @example
 *   const result = await searchExercises({ q: 'bench press', limit: 20 });
 */
export async function searchExercises(
  params: ExerciseSearchParams = {},
): Promise<ExerciseSearchResult> {
  const { data } = await api.get<ExerciseSearchResult>('/exercises/search', {
    params: {
      ...(params.q && { q: params.q }),
      ...(params.muscleGroup && { muscleGroup: params.muscleGroup }),
      ...(params.equipment && { equipment: params.equipment }),
      ...(params.limit && { limit: params.limit }),
      ...(params.cursor && { cursor: params.cursor }),
    },
  });
  return data;
}

/**
 * Fetch a single exercise by its ExerciseDB catalog id.
 */
export async function getExerciseById(id: string): Promise<Exercise> {
  const { data } = await api.get<Exercise>(`/exercises/${encodeURIComponent(id)}`);
  return data;
}
