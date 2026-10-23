/**
 * The client_path_change rows of the coach's Roman drafts list, oldest sent first (backend #1120 paged queue).
 * Behind `featureFlags.clientPathCopilot`. A server without the paged queue answers the old array: no rows (nothing new).
 * Names come from the coach's own roster (the draft carries only the client id; the server keeps it to his clients).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { featureFlags } from '../../../config/featureFlags';
import { programKeys } from '../../../hooks/usePrograms';
import { programsApi } from '../../../api/programsApi';
import { copilotApi } from '../../../api/copilotApi';
import { COACH_AI_PENDING_DRAFTS_REFETCH_MS } from '../../../hooks/usePendingAiDrafts';
import { QuietError, loadFailureMessage } from '../../../ui/states/QuietStates';
import { PathChangeDraftCard } from './PathChangeDraftCard';

export const PATH_DRAFTS_KEY = ['copilot', 'path-change-drafts'] as const;

export function usePathChangeDrafts(enabled: boolean) {
  const on = enabled && featureFlags.clientPathCopilot;
  return useQuery({
    queryKey: PATH_DRAFTS_KEY,
    queryFn: () => copilotApi.pathChangeDrafts(),
    enabled: on,
    refetchInterval: on ? COACH_AI_PENDING_DRAFTS_REFETCH_MS : false,
  });
}

/** The screen owns the read; `showError` false while its own error already says the list did not load. */
export function PathChangeDrafts({ query, showError = true }: { query: ReturnType<typeof usePathChangeDrafts>; showError?: boolean }) {
  const qc = useQueryClient();
  const drafts = query.data ?? [];
  const roster = useQuery({ queryKey: programKeys.clients, queryFn: () => programsApi.assignableClients(), enabled: drafts.length > 0 });
  if (query.isError && !query.data) return showError ? <QuietError message={loadFailureMessage(query.error, 'Pending AI drafts')}
    onRetry={() => void query.refetch()} retrying={query.isFetching} layout="inline" testID="path-drafts-error" /> : null;
  if (drafts.length === 0) return null;
  const names = new Map((roster.data ?? []).map((c) => [c.id, c.name]));
  return (
    <View style={s.list} testID="path-change-drafts">
      {drafts.map((d) => (
        <PathChangeDraftCard key={d.id} draft={d} clientName={names.get(d.clientId) ?? null}
          onDecided={() => void qc.invalidateQueries({ queryKey: PATH_DRAFTS_KEY })} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({ list: { gap: 12, marginBottom: 12 } });
