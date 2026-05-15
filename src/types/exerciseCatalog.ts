/**
 * exerciseCatalog types
 *
 * Mirrors the v1 contract from the backend branch
 * `feat/video-library-v1-backend`:
 *
 *   GET /exercise-catalog
 *     query: category?, primaryMuscle?, equipment?, q?, cursor?, limit?
 *     → { items: Exercise[]; nextCursor: string | null; total: number }
 *
 *   GET /exercise-catalog/:idOrSlug
 *     → Exercise & { playbackUrl: string | null }
 *
 * The list endpoint returns the base Exercise rows (no `playbackUrl`).
 * The detail endpoint mints a signed Mux HLS URL on demand and returns
 * it as `playbackUrl`; if Mux is not configured the controller returns
 * 503 with `{ error: 'mux_disabled', action: '...' }`. The mobile
 * caller is responsible for treating that as "video unavailable".
 *
 * v1 limitation: `muxPlaybackId` is attached server-side via the
 * backend's owner API. There is no coach-side upload UI yet.
 */

export interface Exercise {
  id: string;
  slug: string;
  name: string;
  category: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  equipment: string[];
  difficulty: string;
  instructions: string[];
  /** Present when an owner has attached a Mux asset to this exercise. */
  muxPlaybackId?: string | null;
}

export interface ExerciseDetail extends Exercise {
  /**
   * Signed Mux HLS URL. `null` when the exercise has no `muxPlaybackId`
   * or when the backend has Mux disabled. UI must hide the player and
   * show a caption in that case.
   */
  playbackUrl: string | null;
}

export interface ExerciseListParams {
  q?: string;
  category?: string;
  primaryMuscle?: string;
  equipment?: string;
  /** 1-100, default 20 (matches backend). */
  limit?: number;
  /** Opaque cursor returned by a prior call. */
  cursor?: string;
}

export interface ExerciseListResponse {
  items: Exercise[];
  nextCursor: string | null;
  total: number;
}

/**
 * Body shape for the backend's 503 when Mux is unconfigured. The new
 * catalog endpoints return this only on the detail route — list still
 * works because list items don't carry a playback URL.
 */
export interface MuxDisabledError {
  error: 'mux_disabled';
  action: string;
}
