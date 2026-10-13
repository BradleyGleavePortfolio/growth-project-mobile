/**
 * UI-2: the reads behind the coach Home, all on existing endpoints. Each read settles on its own, so a slow
 * one never holds the others back; only the newest load writes, and nothing writes after unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { commandCenterApi, type AtRiskEntry, type CommandCenterOverview } from '../../../services/commandCenterApi';
import { fetchUnreadCount } from '../../../services/notificationsApi';
import { usePendingAiDrafts } from '../../../hooks/usePendingAiDrafts';
import { isStream2Capability } from '../../../api/types/coachAiExecution';
import { isSubCoachBillingBlocked } from '../../../lib/coachSetup/errors';
import type { LtvMetrics } from '../../../components/command-center/CoachLtvDashboard';
import type { MoneyPayout, MoneySummary } from '../../../api/coachMoneyApi';
import { coachHomeSources, type CoachHomeSources } from '../command-center/coachHomeSources';

export type MonthState = { kind: 'loading' | 'blocked' | 'error' } | { kind: 'ok'; summary: MoneySummary };

export interface CoachHomeData {
  overview: CommandCenterOverview | null;
  overviewFailed: boolean;
  refreshing: boolean;
  urgent: AtRiskEntry[];
  ltv: LtvMetrics | null;
  month: MonthState;
  payout: MoneyPayout | null;
  unreadNotifications: number;
  /** The drafts the queue (PendingAiDrafts) shows: workout and meal plan suggestions, check-in nudges. */
  draftsWaiting: number;
  now: Date;
}

export function useCoachHomeV11(sources: CoachHomeSources = coachHomeSources) {
  const isFocused = useIsFocused();
  const drafts = usePendingAiDrafts({ enabled: isFocused });
  const [overview, setOverview] = useState<CommandCenterOverview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [urgent, setUrgent] = useState<AtRiskEntry[]>([]);
  const [ltv, setLtv] = useState<LtvMetrics | null>(null);
  const [month, setMonth] = useState<MonthState>({ kind: 'loading' });
  const [payout, setPayout] = useState<MoneyPayout | null>(null);
  const [unreadNotifications, setUnread] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const seq = useRef(0);
  useEffect(() => () => { seq.current += 1; }, []);

  const loadMonth = useCallback((mine: number) => {
    sources.monthSoFar()
      .then((summary) => { if (mine === seq.current) setMonth({ kind: 'ok', summary }); })
      .catch((err) => { if (mine === seq.current) setMonth({ kind: isSubCoachBillingBlocked(err) ? 'blocked' : 'error' }); });
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
    settle(sources.atRisk, setUrgent, []);
    settle(sources.ltv, setLtv, null);
    settle(sources.nextPayout, setPayout, null);
    settle(fetchUnreadCount, setUnread, 0);
    try {
      const res = await commandCenterApi.getOverview();
      if (fresh()) setOverview(res.data);
    } catch {
      if (fresh()) setOverviewFailed(true);
    } finally {
      if (fresh()) setRefreshing(false);
    }
    if (isRefresh) void drafts.refetch();
  }, [drafts, loadMonth, sources]);

  // The first load runs once, with the newest `load`.
  const first = useRef(load);
  first.current = load;
  useEffect(() => { void first.current(false); }, []);

  const draftsWaiting = (drafts.data?.drafts ?? []).filter((d) => isStream2Capability(d.capability)).length;
  const data: CoachHomeData = { overview, overviewFailed, refreshing, urgent, ltv, month, payout, unreadNotifications, draftsWaiting, now };
  return { data, reload: load, retryMonth: () => loadMonth(seq.current) };
}
