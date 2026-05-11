/**
 * useMacros — React Query hooks over macrosApi (Sprint B v2 backend).
 *
 * Coach surface: per-client macro target CRUD + Mifflin-St Jeor preset.
 * Client surface: current target via /me/macros/current.
 *
 * Query keys:
 *   ['macros', 'client', clientId]              — full history (coach view)
 *   ['macros', 'client', clientId, 'current']   — current target (coach view)
 *   ['macros', 'me', 'current']                 — current target (client view)
 *
 * The Mifflin-St Jeor preset is a pure function on the server. We expose
 * it as a mutation because it is request-shaped (POST body) and clients
 * tend to call it on form-button press rather than reactively. No
 * caching — the result is cheap to recompute.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  macrosApi,
  type CreateMacroTargetInput,
  type MacroPresetInput,
  type MacroPresetOutput,
  type MacroTarget,
} from '../api/macrosApi';

const FIVE_MIN_MS = 5 * 60 * 1000;

export function useClientMacroHistory(clientId: string | undefined) {
  return useQuery<MacroTarget[]>({
    queryKey: ['macros', 'client', clientId],
    queryFn: () =>
      macrosApi.listForClient(clientId as string).then((r) => r.data),
    enabled: !!clientId,
    staleTime: FIVE_MIN_MS,
  });
}

export function useCurrentMacrosForClient(clientId: string | undefined) {
  return useQuery<MacroTarget | null>({
    queryKey: ['macros', 'client', clientId, 'current'],
    queryFn: () =>
      macrosApi
        .currentForClient(clientId as string)
        .then((r) => r.data),
    enabled: !!clientId,
    staleTime: FIVE_MIN_MS,
  });
}

export function useCurrentMacrosForSelf() {
  return useQuery<MacroTarget | null>({
    queryKey: ['macros', 'me', 'current'],
    queryFn: () => macrosApi.currentForSelf().then((r) => r.data),
    staleTime: FIVE_MIN_MS,
  });
}

export function useCreateMacroTarget() {
  const qc = useQueryClient();
  return useMutation<
    MacroTarget,
    Error,
    { clientId: string; input: CreateMacroTargetInput }
  >({
    mutationFn: (args) =>
      macrosApi.createForClient(args.clientId, args.input).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['macros', 'client', vars.clientId] });
    },
  });
}

export function useArchiveMacroTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) =>
      macrosApi.archive(targetId).then((r) => r.data),
    onSuccess: () => {
      // Coarse invalidation — we don't know which client owned the row
      // and the cost of re-fetching macros queries is small.
      qc.invalidateQueries({ queryKey: ['macros'] });
    },
  });
}

export function useMacroPreset() {
  return useMutation<MacroPresetOutput, Error, MacroPresetInput>({
    mutationFn: (input) =>
      macrosApi.computePreset(input).then((r) => r.data),
  });
}
