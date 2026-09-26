/**
 * useImportRunStatus / useImportedRoster — S12-B3 (M-bind) reads for the
 * coach's import verdict. Both are pure server reads; neither ever invents a
 * state the server did not send (see src/types/importRunStatus.ts).
 *
 * useImportRunStatus(intentId)
 *   - GET scout/import/status for the PAIRED intent only (the pairing hook's
 *     server-issued import_intent_id). Disabled — no request, no listener —
 *     when `extensionImport` is off, no coach is known, or no intent is known.
 *   - Coach id + intent id are in the query key: one coach or one intent never
 *     inherits another's reading (and react-query never shows a previous key's
 *     data under a new key — no placeholderData).
 *   - Retries follow the app's central read policy (src/services/queryClient.ts).
 *   - Re-reads every POLL_MS while the run is not terminal (or not yet known),
 *     stops polling on a recognised terminal, and re-reads on app foreground.
 *   - Stale-read handling (readiness-panel pattern, mobile a876268c): a failed
 *     refresh keeps the last reading but marks it `stale` with the time it was
 *     read, so a point-in-time answer is never presented as current. A 404 or
 *     an undecodable body is a fresh answer ("not known yet" / "not
 *     recognised") and replaces any earlier reading.
 *
 * useImportedRoster(intentId, settled)
 *   - GET scout/reconstruct/roster, mounted ONLY when BOTH `extensionImport`
 *     and `importReview` (EXPO_PUBLIC_FF_IMPORT_REVIEW, default OFF) are on,
 *     and only once the status read shows a recognised terminal (the roster is
 *     a settled intent's read). Cursor-paginated, rows deduped by id.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { featureFlags } from '../config/featureFlags';
import { useCurrentUser } from './useCurrentUser';
import { importRunStatusApi } from '../api/importRunStatusApi';
import {
  decodeRosterPage,
  decodeRunStatus,
  isTerminal,
  type DecodedRosterAccounting,
  type DecodedRosterPage,
  type DecodedRosterPerson,
  type DecodedRunStatus,
} from '../types/importRunStatus';

export const IMPORT_STATUS_POLL_MS = 20_000;

type StatusResult =
  | { kind: 'reading'; reading: DecodedRunStatus }
  | { kind: 'notFound' }
  | { kind: 'unreadable' };

export type RunStatusView = 'disabled' | 'loading' | 'error' | StatusResult['kind'];

export interface ImportRunStatus {
  view: RunStatusView;
  reading?: DecodedRunStatus;
  /** A later refresh failed; `reading`/`view` are the last answer, read at `readAt`. */
  stale: boolean;
  /** Epoch ms of the answer on screen, or null when none. */
  readAt: number | null;
  isRefreshing: boolean;
  refresh: () => void;
}

function useForegroundRefresh(enabled: boolean, refresh: () => void): void {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') ref.current();
    });
    return () => sub.remove();
  }, [enabled]);
}

export function useImportRunStatus(intentId: string | null | undefined): ImportRunStatus {
  const coachId = useCurrentUser()?.id ?? null;
  const intent = typeof intentId === 'string' && intentId.length > 0 ? intentId : null;
  const enabled = featureFlags.extensionImport && !!coachId && !!intent;

  const query = useQuery({
    queryKey: ['import', 'runStatus', coachId ?? '∅', intent ?? '∅'],
    queryFn: async (): Promise<StatusResult> => {
      const raw = await importRunStatusApi.status(intent as string);
      if (raw.kind === 'notFound') return { kind: 'notFound' };
      const reading = decodeRunStatus(raw.body, intent as string);
      return reading ? { kind: 'reading', reading } : { kind: 'unreadable' };
    },
    enabled,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.kind === 'reading' && isTerminal(d.reading.status) ? false : IMPORT_STATUS_POLL_MS;
    },
  });

  const refresh = useCallback(() => {
    if (enabled) void query.refetch();
  }, [enabled, query]);
  useForegroundRefresh(enabled, refresh);

  if (!enabled) return { view: 'disabled', stale: false, readAt: null, isRefreshing: false, refresh };
  const data = query.data;
  if (data === undefined) {
    return {
      view: query.isError ? 'error' : 'loading',
      stale: false,
      readAt: null,
      isRefreshing: query.isFetching,
      refresh,
    };
  }
  return {
    view: data.kind,
    ...(data.kind === 'reading' ? { reading: data.reading } : {}),
    stale: query.isError,
    readAt: query.dataUpdatedAt || null,
    isRefreshing: query.isFetching,
    refresh,
  };
}

type RosterResult = { kind: 'page'; page: DecodedRosterPage } | { kind: 'notFound' } | { kind: 'unreadable' };

export type RosterView = 'disabled' | 'loading' | 'error' | 'notFound' | 'unreadable' | 'page';

export interface ImportedRoster {
  view: RosterView;
  persons: DecodedRosterPerson[];
  /** From the most recently loaded page; undefined = not known. */
  accounting?: DecodedRosterAccounting;
  rosterBridgePending: boolean | null;
  hasMore: boolean;
  /** A later page (or refresh) failed or was undecodable; loaded rows stay, marked incomplete. */
  incomplete: boolean;
  isFetchingMore: boolean;
  fetchMore: () => void;
  refresh: () => void;
}

export function useImportedRoster(intentId: string | null | undefined, settled: boolean): ImportedRoster {
  const coachId = useCurrentUser()?.id ?? null;
  const intent = typeof intentId === 'string' && intentId.length > 0 ? intentId : null;
  // Two independent kill switches, both required; importReview defaults OFF.
  const enabled =
    featureFlags.extensionImport && featureFlags.importReview && !!coachId && !!intent && settled;

  const query = useInfiniteQuery({
    queryKey: ['import', 'roster', coachId ?? '∅', intent ?? '∅'],
    queryFn: async ({ pageParam }): Promise<RosterResult> => {
      const raw = await importRunStatusApi.roster(intent as string, pageParam);
      if (raw.kind === 'notFound') return { kind: 'notFound' };
      const page = decodeRosterPage(raw.body, intent as string);
      return page ? { kind: 'page', page } : { kind: 'unreadable' };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.kind === 'page' && last.page.hasMore && last.page.nextCursor ? last.page.nextCursor : undefined,
    enabled,
  });

  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);
  const loaded = useMemo(
    () => pages.filter((p): p is { kind: 'page'; page: DecodedRosterPage } => p.kind === 'page'),
    [pages],
  );
  const persons = useMemo(() => {
    const seen = new Set<string>();
    const out: DecodedRosterPerson[] = [];
    for (const { page } of loaded) {
      for (const person of page.persons) {
        if (seen.has(person.id)) continue;
        seen.add(person.id);
        out.push(person);
      }
    }
    return out;
  }, [loaded]);

  const refresh = useCallback(() => {
    if (enabled) void query.refetch();
  }, [enabled, query]);
  const fetchMore = useCallback(() => {
    if (enabled && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [enabled, query]);
  useForegroundRefresh(enabled, refresh);

  const base = {
    persons: [] as DecodedRosterPerson[],
    rosterBridgePending: null,
    hasMore: false,
    incomplete: false,
    isFetchingMore: false,
    fetchMore,
    refresh,
  };
  if (!enabled) return { ...base, view: 'disabled' };
  if (pages.length === 0) return { ...base, view: query.isError ? 'error' : 'loading' };
  const first = pages[0];
  if (first.kind !== 'page') return { ...base, view: first.kind };
  const last = loaded[loaded.length - 1].page;
  return {
    view: 'page',
    persons,
    ...(last.accounting ? { accounting: last.accounting } : {}),
    rosterBridgePending: last.rosterBridgePending,
    hasMore: query.hasNextPage ?? false,
    incomplete: query.isError || loaded.length !== pages.length,
    isFetchingMore: query.isFetchingNextPage,
    fetchMore,
    refresh,
  };
}
