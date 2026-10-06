/**
 * S-MWB — React Query hooks for the coach Programs library. Query keys live
 * here so every screen invalidates the same caches after a mutation.
 */
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { programsApi, ProgramStatusFilter } from "../api/programsApi";

export const programKeys = {
  all: ["coach", "programs"] as const,
  list: (q: string, goalTag: string | null, status: ProgramStatusFilter) =>
    ["coach", "programs", "list", q, goalTag ?? "", status] as const,
  detail: (id: string) => ["coach", "programs", "detail", id] as const,
  revisions: (id: string) => ["coach", "programs", "revisions", id] as const,
  assignees: (id: string) => ["coach", "programs", "assignees", id] as const,
  saved: (q: string) => ["coach", "programs", "saved-workouts", q] as const,
  clients: ["coach", "programs", "assignable-clients"] as const,
};

export function useProgramList(
  q: string,
  goalTag: string | null,
  status: ProgramStatusFilter,
) {
  return useInfiniteQuery({
    queryKey: programKeys.list(q, goalTag, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      programsApi.list({
        q,
        goal_tag: goalTag ?? undefined,
        status,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useProgram(id: string) {
  return useQuery({
    queryKey: programKeys.detail(id),
    queryFn: () => programsApi.get(id),
  });
}

export function useProgramRevisions(id: string) {
  return useQuery({
    queryKey: programKeys.revisions(id),
    queryFn: () => programsApi.revisions(id),
  });
}

export function useProgramAssignees(id: string) {
  return useInfiniteQuery({
    queryKey: programKeys.assignees(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => programsApi.assignees(id, pageParam),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useSavedWorkouts(q: string) {
  return useInfiniteQuery({
    queryKey: programKeys.saved(q),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      programsApi.savedWorkouts({ q, cursor: pageParam }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useAssignableClients() {
  return useQuery({
    queryKey: programKeys.clients,
    queryFn: () => programsApi.assignableClients(),
  });
}

/** Invalidate every Programs cache (after any write). */
export function useInvalidatePrograms() {
  const qc = useQueryClient();
  return useCallback(
    () => qc.invalidateQueries({ queryKey: programKeys.all }),
    [qc],
  );
}
