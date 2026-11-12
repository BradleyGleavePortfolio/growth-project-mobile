/**
 * FIX-928-BW (agent 197, owner #197-E10): which exercises of the live workout
 * are body-weight, so their sets read "BW × 60 sec". Same cached catalog read
 * as the name lookup (exerciseByIdQuery). A screen rendered without a
 * QueryClientProvider (some host-wiring tests) gets {} and reads as main.
 *
 * BW-LOCAL-M (agent 203): given the rows' names, an id the catalog can never
 * answer (one the phone made, or a library uuid) is looked up in the phone's
 * own exercise list, by id, then by name. A catalog answer always wins.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, useQueries, useQueryClient } from '@tanstack/react-query';
import { bodyWeightMap, byIdQuery, uniqueIds } from './exerciseByIdQuery';
import { getAllExercises, type Exercise as ListExercise } from '../db/workoutDb';
import { isBodyWeightEquipment } from '../utils/workout/bodyWeight';
import { isPhoneMadeId, libraryExerciseId, slugifyExerciseName } from '../utils/workout/exerciseId';

// Used only where a screen is rendered without a QueryClientProvider (some
// host-wiring tests of the live workout): nothing is fetched or kept there.
const NO_PROVIDER_CLIENT = new QueryClient();
function useOptionalQueryClient(): QueryClient | null {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

/** An id GET /exercises/:id can never answer: phone-made, or a library uuid. */
const listCanAnswer = (id: string) => isPhoneMadeId(id) || libraryExerciseId(id) !== null;

/** The catalog's map plus the phone list's answer for ids the catalog has none for. */
export function withPhoneList(
  catalog: Record<string, boolean>, unique: string[], names: Record<string, string>,
  list: ReadonlyArray<Pick<ListExercise, 'id' | 'name' | 'equipment'>>,
): Record<string, boolean> {
  const out = { ...catalog };
  unique.forEach((id) => {
    if (id in catalog || !listCanAnswer(id)) return;
    const slug = slugifyExerciseName(names[id] ?? '');
    const row = list.find((e) => e.id === id) ?? (slug ? list.find((e) => slugifyExerciseName(e.name) === slug) : undefined);
    if (row) out[id] = isBodyWeightEquipment(row.equipment);
  });
  return out;
}

/**
 * ids of these exercises whose equipment is body weight (true). With `names`
 * (id -> exercise name, the live workout), the phone's own list is read once
 * per mount, the first time an id only it can answer is present.
 */
export function useBodyWeightExercises(ids: string[], names?: Record<string, string>): Record<string, boolean> {
  const client = useOptionalQueryClient();
  const unique = useMemo(() => uniqueIds(ids), [ids]);
  const results = useQueries(
    { queries: unique.map((id) => (client ? byIdQuery(id) : { ...byIdQuery(id), enabled: false, gcTime: Infinity })) },
    client ?? NO_PROVIDER_CLIENT,
  );
  const [list, setList] = useState<ListExercise[] | null>(null);
  const mounted = useRef(true);
  const listAsked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const wantsList = !!client && !!names && unique.some(listCanAnswer);
  useEffect(() => {
    if (!wantsList || listAsked.current) return;
    listAsked.current = true;
    // A failed read leaves every row as main (no alert; Add exercise has its own).
    getAllExercises().then((rows) => { if (mounted.current) setList(rows); }, () => undefined);
  }, [wantsList]);
  if (!client) return {};
  const catalog = bodyWeightMap(unique, results);
  return names && list ? withPhoneList(catalog, unique, names, list) : catalog;
}
