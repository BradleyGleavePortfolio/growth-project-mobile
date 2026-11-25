/**
 * The one catalog read by id (GET /exercises/:id), shared by the name lookup
 * (useExerciseNames) and, FIX-928-BW, the live workout's body-weight lookup
 * (useBodyWeightExercises). One query key, so the phone reads each id once.
 */
import { exerciseLibraryApi, type Exercise } from '../api/exerciseLibraryApi';
import { isBodyWeightEquipment } from '../utils/workout/bodyWeight';
import { isPhoneMadeId } from '../utils/workout/exerciseId';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export const uniqueIds = (ids: string[]) =>
  Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));

/**
 * LS-928 B2: retry a catalog read by id once, but never an answer that will
 * not change (a 4xx such as 404 for an id the catalog does not hold, e.g. a
 * phone-made `ex_` id). A timeout (408), rate limit (429), 5xx or no answer
 * at all is retried once, as before.
 */
export function catalogReadRetry(failureCount: number, error: unknown): boolean {
  const response = (error as { response?: { status?: unknown; data?: { code?: unknown } } } | null)?.response;
  const status = response?.status;
  const terminal = (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429)
    // The server answers 503 EXERCISEDB_NOT_CONFIGURED for any id outside its seed catalog when it has no catalog key.
    || (status === 503 && response?.data?.code === 'EXERCISEDB_NOT_CONFIGURED');
  return !terminal && failureCount < 1;
}

export const byIdQuery = (id: string) => ({
  queryKey: ['exercises', 'by-id', id],
  queryFn: () => exerciseLibraryApi.getById(id).then((r) => r.data as Exercise),
  staleTime: FIFTEEN_MIN_MS,
  // An id the phone made (ex_..., LO-928 C1) is asked once and never again.
  retry: isPhoneMadeId(id) ? false : catalogReadRetry,
});

/** ids whose catalog equipment is body weight (true); ids not read yet are absent. */
export function bodyWeightMap(unique: string[], results: ReadonlyArray<{ data?: Exercise }>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  unique.forEach((id, i) => {
    const data = results[i]?.data;
    if (data) out[id] = isBodyWeightEquipment(data.equipment);
  });
  return out;
}
