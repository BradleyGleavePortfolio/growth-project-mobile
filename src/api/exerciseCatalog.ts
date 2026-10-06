/**
 * exerciseCatalog API client
 *
 * Typed client for the v1 video-library exercise catalog endpoints
 * introduced by the backend branch `feat/video-library-v1-backend`:
 *
 *   GET /exercise-catalog          → list with chip filters + cursor
 *   GET /exercise-catalog/:idOrSlug → detail incl. signed Mux HLS URL
 *
 * This is intentionally separate from the legacy `exerciseLibraryApi.ts`
 * which speaks to the older `/exercises/*` ExerciseDB proxy (different
 * Exercise shape, no `playbackUrl`). The two clients coexist while the
 * UI migrates to the new catalog.
 *
 * Mux configuration on the backend is optional: when Mux secrets are
 * unset, the detail route still 200s with `playbackUrl: null` — only
 * the (currently internal) attach-asset route 503s with
 *   { error: 'mux_disabled', action: '...' }.
 * UI just needs to treat `playbackUrl === null` as "no video yet".
 */

import api from '../services/api';
import type { AxiosResponse } from 'axios';
import { exerciseLibraryApi } from './exerciseLibraryApi';
import type {
  ExerciseDetail,
  ExerciseListParams,
  ExerciseListResponse,
} from '../types/exerciseCatalog';

function toQueryString(params: ExerciseListParams): string {
  const parts: string[] = [];
  if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
  if (params.category)
    parts.push(`category=${encodeURIComponent(params.category)}`);
  if (params.primaryMuscle)
    parts.push(`primaryMuscle=${encodeURIComponent(params.primaryMuscle)}`);
  if (params.equipment)
    parts.push(`equipment=${encodeURIComponent(params.equipment)}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.cursor)
    parts.push(`cursor=${encodeURIComponent(params.cursor)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export const exerciseCatalogApi = {
  list: (params: ExerciseListParams = {}) =>
    api.get<ExerciseListResponse>(`/exercise-catalog${toQueryString(params)}`),

  getByIdOrSlug: (idOrSlug: string) =>
    api.get<ExerciseDetail>(
      `/exercise-catalog/${encodeURIComponent(idOrSlug)}`,
    ),

  // Existing assigned workouts use ExerciseDB/seed IDs, not catalog UUIDs.
  // Fall back only on a missing catalog entry, never on an access error.
  getDetail: async (idOrSlug: string): Promise<AxiosResponse<ExerciseDetail>> => {
    try {
      return await exerciseCatalogApi.getByIdOrSlug(idOrSlug);
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status !== 404) throw error;
      const response = await exerciseLibraryApi.getById(idOrSlug);
      const exercise = response.data;
      const data: ExerciseDetail = {
        id: exercise.id,
        slug: exercise.id,
        name: exercise.name,
        category: exercise.bodyPart,
        primaryMuscle: exercise.target,
        secondaryMuscles: exercise.secondaryMuscles ?? [],
        equipment: exercise.equipment ? [exercise.equipment] : [],
        difficulty: '',
        instructions: exercise.instructions ?? [],
        playbackUrl: exercise.video_url ?? null,
        gifUrl: exercise.gifUrl || null,
      };
      return { ...response, data };
    }
  },
};

export type { ExerciseDetail, ExerciseListParams, ExerciseListResponse };
