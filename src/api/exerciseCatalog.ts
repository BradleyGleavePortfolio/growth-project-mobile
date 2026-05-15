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
};

export type { ExerciseDetail, ExerciseListParams, ExerciseListResponse };
