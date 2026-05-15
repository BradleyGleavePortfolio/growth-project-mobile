/**
 * exerciseLibraryApi
 *
 * Typed client for the Sprint B v2 exercise catalog endpoints
 * (PR #188 backend). Reads from the backend's ExerciseDB proxy with
 * an offline seed-catalog fallback when the upstream key is unset.
 *
 * Backend contract source of truth:
 *   src/exercise-library/exercise-library.controller.ts
 *   src/exercise-library/exercise.entity.ts
 *
 * Notes for callers:
 *   - `id` values prefixed with `seed:` come from the in-process seed
 *     catalog (about 50 curated entries). Everything else is a real
 *     ExerciseDB id and resolves through the upstream proxy.
 *   - `gifUrl` is empty string for seed entries and only populated by
 *     ExerciseDB. UI should fall back to a static thumbnail.
 */

import api from '../services/api';

// ─── Types (mirror backend Exercise entity) ─────────────────────────────────

export interface Exercise {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  secondaryMuscles: string[];
  instructions: string[];
  gifUrl: string;
  /**
   * Optional mp4 demo URL. Present once the backend video pipeline
   * (Mux / signed URL) lands — mobile already wires through to the
   * appropriate player. Until then the client falls back to gifUrl
   * and, finally, a static placeholder + instruction text. The
   * mobile NEVER fabricates a video URL.
   */
  video_url?: string | null;
  /** Mux playback id, when the backend opts to serve via HLS instead of a direct mp4. */
  mux_playback_id?: string | null;
}

export interface ExerciseSearchParams {
  q?: string;
  muscleGroup?: string;
  equipment?: string;
  /** 1-100, default 20. */
  limit?: number;
  /** Opaque cursor returned by a prior call. */
  cursor?: string;
}

export interface ExerciseSearchResult {
  items: Exercise[];
  nextCursor: string | null;
  total: number;
}

// ─── API ─────────────────────────────────────────────────────────────────────

function toQueryString(params: ExerciseSearchParams): string {
  const parts: string[] = [];
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.muscleGroup)
    parts.push(`muscleGroup=${encodeURIComponent(params.muscleGroup)}`);
  if (params.equipment)
    parts.push(`equipment=${encodeURIComponent(params.equipment)}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.cursor) parts.push(`cursor=${encodeURIComponent(params.cursor)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export const exerciseLibraryApi = {
  search: (params: ExerciseSearchParams = {}) =>
    api.get<ExerciseSearchResult>(`/exercises/search${toQueryString(params)}`),

  getById: (id: string) =>
    api.get<Exercise>(`/exercises/${encodeURIComponent(id)}`),
};
