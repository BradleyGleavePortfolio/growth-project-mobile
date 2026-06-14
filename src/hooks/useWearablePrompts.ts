/**
 * useWearablePrompts — React Query hooks for the v3-4 COACH-ONLY wearable
 * coaching prompts surface.
 *
 * Read: useWearablePrompts lists a coach's active prompts in a workspace
 * (disabled until the workspace id is present). Mutations: generate / dismiss /
 * act-on each invalidate the list so the surface reconciles with the server.
 *
 * NOTE (TanStack Query v5): post-`mutateAsync` the caller reads the resolved
 * value from the awaited promise; component code that needs `result.current.data`
 * must `await waitFor(() => ...)` (see the screen tests). These hooks return the
 * mutation objects directly and do no optimistic mutation of health data (the
 * server is authoritative — generation has consent/connector/cooldown gates).
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  communityWearablePromptsApi,
  type GenerateResponse,
  type GeneratePromptsInput,
  type PromptListResponse,
  type PromptView,
} from '../api/communityWearablePromptsApi';

// ─── Query keys (stable, namespaced) ─────────────────────────────────────────

export const wearablePromptsKeys = {
  all: ['community', 'wearablePrompts'] as const,
  list: (workspaceId: string, clientId?: string, includeDismissed?: boolean) =>
    [
      ...wearablePromptsKeys.all,
      workspaceId,
      clientId ?? '∅',
      includeDismissed ? 'withDismissed' : 'active',
    ] as const,
};

export interface UseWearablePromptsOptions {
  workspaceId?: string;
  clientId?: string;
  includeDismissed?: boolean;
}

export function useWearablePrompts(
  opts: UseWearablePromptsOptions,
): UseQueryResult<PromptListResponse, Error> {
  const enabled = Boolean(opts.workspaceId);
  return useQuery({
    queryKey: wearablePromptsKeys.list(
      opts.workspaceId ?? '∅',
      opts.clientId,
      opts.includeDismissed,
    ),
    enabled,
    queryFn: () =>
      communityWearablePromptsApi.list(opts.workspaceId as string, {
        clientId: opts.clientId,
        includeDismissed: opts.includeDismissed,
      }),
    staleTime: 30_000,
  });
}

export function useGenerateWearablePrompts(
  workspaceId: string | undefined,
): UseMutationResult<GenerateResponse, Error, GeneratePromptsInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GeneratePromptsInput) =>
      communityWearablePromptsApi.generate(workspaceId as string, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wearablePromptsKeys.all });
    },
  });
}

export function useDismissWearablePrompt(
  workspaceId: string | undefined,
): UseMutationResult<PromptView, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (promptId: string) =>
      communityWearablePromptsApi.dismiss(workspaceId as string, promptId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wearablePromptsKeys.all });
    },
  });
}

export function useActOnWearablePrompt(
  workspaceId: string | undefined,
): UseMutationResult<PromptView, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (promptId: string) =>
      communityWearablePromptsApi.actOn(workspaceId as string, promptId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wearablePromptsKeys.all });
    },
  });
}
