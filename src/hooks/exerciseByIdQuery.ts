/**
 * The one catalog read by id (GET /exercises/:id), shared by the name lookup
 * (useExerciseNames) and, FIX-928-BW, the live workout's body-weight lookup
 * (useBodyWeightExercises). One query key, so the phone reads each id once.
 */
import { exerciseLibraryApi, type Exercise } from '../api/exerciseLibraryApi';
import { isBodyWeightEquipment } from '../utils/workout/bodyWeight';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export const uniqueIds = (ids: string[]) =>
  Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));

export const byIdQuery = (id: string) => ({
  queryKey: ['exercises', 'by-id', id],
  queryFn: () => exerciseLibraryApi.getById(id).then((r) => r.data as Exercise),
  staleTime: FIFTEEN_MIN_MS,
  retry: 1,
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
