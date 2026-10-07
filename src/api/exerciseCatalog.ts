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
import type { Exercise as LibraryExercise } from './exerciseLibraryApi';
import type {
  Exercise,
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

function sentenceCase(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

// Map the /exercises (ExerciseDB proxy / seed) shape onto the catalog shape.
function fromLibrary(exercise: LibraryExercise): Exercise {
  return {
    id: exercise.id,
    slug: exercise.id,
    name: sentenceCase(exercise.name),
    category: exercise.bodyPart,
    primaryMuscle: exercise.target,
    secondaryMuscles: exercise.secondaryMuscles ?? [],
    equipment: exercise.equipment ? [exercise.equipment] : [],
    difficulty: '',
    instructions: exercise.instructions ?? [],
  };
}

function matches(value: string | undefined, wanted: string | undefined): boolean {
  return !wanted || (value ?? '').toLowerCase() === wanted.toLowerCase();
}

export const exerciseCatalogApi = {
  list: (params: ExerciseListParams = {}) =>
    api.get<ExerciseListResponse>(`/exercise-catalog${toQueryString(params)}`),

  getByIdOrSlug: (idOrSlug: string) =>
    api.get<ExerciseDetail>(
      `/exercise-catalog/${encodeURIComponent(idOrSlug)}`,
    ),

  // The client library lists the /exercises source the coach builder uses:
  // the /exercise-catalog table has no rows in production. `category` is the
  // body part. The server applies only one of body part / equipment when no
  // search text is given and caps filtered results at 100, so filtered
  // requests fetch that whole set in one page and both chips are applied here.
  browse: async (params: ExerciseListParams = {}): Promise<AxiosResponse<ExerciseListResponse>> => {
    const filtered = Boolean(params.q || params.category || params.equipment);
    const response = await exerciseLibraryApi.search({
      q: params.q,
      muscleGroup: params.category,
      equipment: params.equipment,
      cursor: params.cursor,
      limit: filtered ? 100 : params.limit,
    });
    const items = response.data.items
      .filter((e) => matches(e.bodyPart, params.category) && matches(e.equipment, params.equipment))
      .map(fromLibrary);
    const total = filtered ? items.length : response.data.total;
    return { ...response, data: { items, nextCursor: response.data.nextCursor, total } };
  },

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
        ...fromLibrary(exercise),
        playbackUrl: exercise.video_url ?? null,
        gifUrl: exercise.gifUrl || null,
      };
      return { ...response, data };
    }
  },
};

export type { ExerciseDetail, ExerciseListParams, ExerciseListResponse };
