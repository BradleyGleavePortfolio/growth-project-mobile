/**
 * useIdentity — fetches founding-number and circle-stats from the backend.
 *
 * Both calls degrade gracefully: if the network fails or the user is not
 * authenticated (404/401), the hook returns null data and never throws.
 * Callers render nothing rather than crashing.
 *
 * UX Psych #3: Identity Reinforcement / Inner Circle
 */
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../services/api';

export function useFoundingNumber() {
  return useQuery({
    queryKey: ['users', 'founding-number'],
    queryFn: async () => {
      try {
        const res = await usersApi.getFoundingNumber();
        return res.data;
      } catch {
        // Any error (network, 401, 404) returns null — show nothing, don't crash
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 min — rank doesn't change often
    retry: false,
  });
}

export function useCircleStats() {
  return useQuery({
    queryKey: ['users', 'circle-stats'],
    queryFn: async () => {
      try {
        const res = await usersApi.getCircleStats();
        return res.data;
      } catch {
        return null;
      }
    },
    staleTime: 2 * 60 * 1000, // 2 min — more dynamic
    retry: false,
  });
}
