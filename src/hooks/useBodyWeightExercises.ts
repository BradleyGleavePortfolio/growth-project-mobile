/**
 * FIX-928-BW (agent 197, owner #197-E10): which exercises of the live workout
 * are body-weight, so their sets read "BW × 60 sec". Same cached catalog read
 * as the name lookup (exerciseByIdQuery). A screen rendered without a
 * QueryClientProvider (some host-wiring tests) gets {} and reads as main.
 */
import { useMemo } from 'react';
import { QueryClient, useQueries, useQueryClient } from '@tanstack/react-query';
import { bodyWeightMap, byIdQuery, uniqueIds } from './exerciseByIdQuery';

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

/** ids of these exercises whose catalog equipment is body weight (true). */
export function useBodyWeightExercises(ids: string[]): Record<string, boolean> {
  const client = useOptionalQueryClient();
  const unique = useMemo(() => uniqueIds(ids), [ids]);
  const results = useQueries(
    { queries: unique.map((id) => (client ? byIdQuery(id) : { ...byIdQuery(id), enabled: false, gcTime: Infinity })) },
    client ?? NO_PROVIDER_CLIENT,
  );
  return client ? bodyWeightMap(unique, results) : {};
}
