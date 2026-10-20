/**
 * UI-2: the reads behind the coach Home, all on existing endpoints. Each read settles on its own, so a slow
 * one never holds the others back; only the newest load writes, and nothing writes after unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { commandCenterApi, type AtRiskEntry, type CommandCenterOverview } from '../../../services/commandCenterApi';
import { useClientUnreadCount } from '../../../hooks/useClientUnreadCount';
import { usePendingAiDrafts } from '../../../hooks/usePendingAiDrafts';
import { isStream2Capability } from '../../../api/types/coachAiExecution';
import { isSubCoachBillingBlocked } from '../../../lib/coachSetup/errors';
import type { LtvMetrics } from '../../../components/command-center/CoachLtvDashboard';
import type { MoneyPayout, MoneySummary } from '../../../api/coachMoneyApi';
import { coachHomeSources, type CoachHomeSources } from '../command-center/coachHomeSources';

export type MonthState = { kind: 'loading' | 'blocked' | 'error' } | { kind: 'ok'; summary: MoneySummary };
/** A read that is still on its way, failed with nothing verified to show, or answered (an empty answer included). */
export type ReadState = 'loading' | 'error' | 'ok';

export interface CoachHomeData {
  overview: CommandCenterOverview | null;
  overviewFailed: boolean;
  refreshing: boolean;
  urgent: AtRiskEntry[];
  urgentState: ReadState;
  ltv: LtvMetrics | null;
  month: MonthState;
  payout: MoneyPayout | null;
  unreadNotifications: number;
  /** The drafts the queue (PendingAiDrafts) shows: workout and meal plan suggestions, check-in nudges. */
  draftsWaiting: number;
  draftsState: ReadState;
  draftsError: unknown;
  draftsRetrying: boolean;
  now: Date;
}

export function useCoachHomeV11(sources: CoachHomeSources = coachHomeSources) {
  const isFocused = useIsFocused();
  const drafts = usePendingAiDrafts({ enabled: isFocused });
  // The bell polls every 30 s and on foreground while Overview is in view, and re-reads on each return to it.
  const unreadNotifications = useClientUnreadCount(isFocused);
  const [overview, setOverview] = useState<CommandCenterOverview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [urgent, setUrgent] = useState<AtRiskEntry[]>([]);
  const [urgentState, setUrgentState] = useState<ReadState>('loading');
  const [ltv, setLtv] = useState<LtvMetrics | null>(null);
  const [month, setMonth] = useState<MonthState>({ kind: 'loading' });
  const [payout, setPayout] = useState<MoneyPayout | null>(null);
  const [now, setNow] = useState(() => new Date());
  const seq = useRef(0);
  useEffect(() => () => { seq.current += 1; }, []);

  const loadMonth = useCallback((mine: number) => {
    sources.monthSoFar()
      .then((summary) => { if (mine === seq.current) setMonth({ kind: 'ok', summary }); })
      .catch((err) => { if (mine === seq.current) setMonth({ kind: isSubCoachBillingBlocked(err) ? 'blocked' : 'error' }); });
  }, [sources]);

  // A failed refresh keeps the list it already verified; only a first failure shows the error.
  const loadUrgent = useCallback((mine: number) => {
    Promise.resolve().then(sources.atRisk)
      .then((v) => { if (mine === seq.current) { setUrgent(v); setUrgentState('ok'); } })
      .catch(() => { if (mine === seq.current) setUrgentState((s) => (s === 'ok' ? 'ok' : 'error')); });
  }, [sources]);

  const load = useCallback(async (isRefresh = false) => {
    const mine = ++seq.current;
    const fresh = () => mine === seq.current;
    setNow(new Date());
    setRefreshing(isRefresh);
    setOverviewFailed(false);
    loadMonth(mine);
    const settle = <T,>(read: () => Promise<T>, write: (v: T) => void, fallback: T) =>
      void Promise.resolve().then(read).catch(() => fallback).then((v) => { if (fresh()) write(v); });
    loadUrgent(mine);
    settle(sources.ltv, setLtv, null);
    settle(sources.nextPayout, setPayout, null);
    try {
      const res = await commandCenterApi.getOverview();
      if (fresh()) setOverview(res.data);
    } catch {
      if (fresh()) setOverviewFailed(true);
    } finally {
      if (fresh()) setRefreshing(false);
    }
    if (isRefresh) void drafts.refetch();
  }, [drafts, loadMonth, loadUrgent, sources]);

  // The first load runs once, with the newest `load`.
  const first = useRef(load);
  first.current = load;
  useEffect(() => { void first.current(false); }, []);

  const draftsWaiting = (drafts.data?.drafts ?? []).filter((d) => isStream2Capability(d.capability)).length;
  // The query keeps its last good answer when a refetch fails, so the button stays while that answer stands.
  const draftsState: ReadState = drafts.data ? 'ok' : drafts.isError ? 'error' : 'loading';
  const data: CoachHomeData = {
    overview, overviewFailed, refreshing, urgent, urgentState, ltv, month, payout, unreadNotifications,
    draftsWaiting, draftsState, draftsError: drafts.error, draftsRetrying: !!drafts.isFetching, now,
  };
  return {
    data, reload: load, retryMonth: () => loadMonth(seq.current),
    retryUrgent: () => { setUrgentState('loading'); loadUrgent(seq.current); },
    retryDrafts: () => void drafts.refetch(),
  };
}
