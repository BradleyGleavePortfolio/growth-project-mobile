/**
 * The reads behind the coach Home (spec #688 6295886580), all on existing endpoints plus `include=home` on the
 * overview (b#1123). Each read settles on its own, so a slow one never holds the others back; only the newest
 * load writes, and nothing writes after unmount. Needs you is counted as the list it opens counts it
 * (ClientLookupScreen, view 'needs'): the active roster and the unread counts, through lookupReason. The
 * Reach-outs sheet lists the at-risk set the ring counts (b#1123 `needsYou`), and each return to the Home re-reads.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import type { AtRiskEntry, CommandCenterOverview } from '../../../services/commandCenterApi';
import { coachApi } from '../../../services/api';
import { useClientUnreadCount } from '../../../hooks/useClientUnreadCount';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { usePendingAiDrafts } from '../../../hooks/usePendingAiDrafts';
import { isStream2Capability } from '../../../api/types/coachAiExecution';
import { isSubCoachBillingBlocked } from '../../../lib/coachSetup/errors';
import type { LtvMetrics } from '../../../components/command-center/CoachLtvDashboard';
import type { MoneyPayout, MoneySummary } from '../../../api/coachMoneyApi';
import { useCoachStore } from '../../../store/coachStore';
import type { LookupReason, UnreadByClient } from '../../../utils/coach/clientLookup';
import { sortRoster, type RosterClient } from '../../../utils/coach/clientRoster';
import { coachHomeSources, type CoachHomeSources } from '../command-center/coachHomeSources';
import { fetchOverviewWithHome, type CoachHomeDay, type OverviewRead } from './homeDay';
import { needsYouReason, useCoachBlockList } from './blockList';
import type { ActionQueueItem } from '../../../services/commandCenterApi';
import { needsYouAreas, type NeedsAreas } from '../../../utils/coach/needsYou';

export type MonthState = { kind: 'loading' | 'blocked' | 'error' } | { kind: 'ok'; summary: MoneySummary };
/** A read that is still on its way, failed with nothing verified to show, or answered (an empty answer included). */
export type ReadState = 'loading' | 'error' | 'ok';

export interface NeedsRow { client: RosterClient; reason: LookupReason }
export interface DraftKinds { workouts: number; mealPlans: number; nudges: number; workoutChanges: number }

export interface CoachHomeData {
  overview: CommandCenterOverview | null;
  /** b#1123's day; null on a server without it (the Home then draws no wins and no rings). */
  home: CoachHomeDay | null;
  overviewFailed: boolean;
  refreshing: boolean;
  /** Who needs the coach, as the Needs you list orders them. */
  needs: NeedsRow[];
  /** NEEDS-YOU-M: the Needs you card's areas, as the list groups them (needsYouAreas). */
  areas: NeedsAreas;
  /** The open alerts read (every page of GET .../action-queue); a failed re-read keeps the last good rows and is 'error' (LS-934 B1). */
  alertsState: ReadState;
  /** The at-risk clients the Reach-outs ring counts, most urgent first (null: not read). */
  reachOuts: AtRiskEntry[] | null;
  /** Active clients not in `needs`, and how many of them logged today (null: the server sent no log days). */
  steady: { count: number; loggedToday: number | null };
  /** 'off': the Clients list is on Archived, so the shared roster is not the active one: no count. */
  rosterState: ReadState | 'off';
  ltv: LtvMetrics | null;
  month: MonthState;
  payout: MoneyPayout | null;
  unreadNotifications: number;
  /** The drafts the queue (PendingAiDrafts) shows, by kind. */
  draftsWaiting: number;
  draftKinds: DraftKinds;
  draftsState: ReadState;
  draftsError: unknown;
  draftsRetrying: boolean;
  now: Date;
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const NOBODY: ReadonlySet<string> = new Set();

/** The Needs you list's rule (ClientLookupScreen, view 'needs': `needsYouReason`), so the tile and the list agree. */
export function needsAndSteady(clients: RosterClient[], unread: UnreadByClient, now: Date, blockedIds: ReadonlySet<string> = NOBODY) {
  const active = clients.filter((c) => c.status !== 'archived');
  const rows = sortRoster(active, 'recent').map((client) => ({ client, reason: needsYouReason(client, unread, blockedIds, now) }));
  const needs = rows.filter((r) => r.reason.action !== null);
  const steadyRows = rows.filter((r) => r.reason.action === null);
  const withDays = steadyRows.filter((r) => r.client.activity);
  const today = localDay(now);
  const loggedToday = withDays.length > 0
    ? withDays.filter((r) => (r.client.activity?.lastActiveOn ?? '') >= today).length
    : null;
  return { needs, steady: { count: steadyRows.length, loggedToday } };
}

/** `pathCopilot`: featureFlags.clientPathCopilot, passed in by the screen (tests import this file before their flag mock). */
export function useCoachHomeV11(sources: CoachHomeSources = coachHomeSources, readOverview: () => Promise<OverviewRead> = fetchOverviewWithHome, pathCopilot = false) {
  const isFocused = useIsFocused();
  const coachId = useCurrentUser()?.id;
  const drafts = usePendingAiDrafts({ enabled: isFocused });
  // The bell polls every 30 s and on foreground while the Home is in view, and re-reads on each return to it.
  const unreadNotifications = useClientUnreadCount(isFocused);
  const clients = useCoachStore((s) => s.clients);
  const [read, setRead] = useState<OverviewRead | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rosterState, setRosterState] = useState<ReadState | 'off'>('loading');
  const [unread, setUnread] = useState<UnreadByClient>({});
  const [ltv, setLtv] = useState<LtvMetrics | null>(null);
  const [month, setMonth] = useState<MonthState>({ kind: 'loading' });
  const [payout, setPayout] = useState<MoneyPayout | null>(null);
  const [reachOuts, setReachOuts] = useState<AtRiskEntry[] | null>(null);
  const [alerts, setAlerts] = useState<ActionQueueItem[] | null>(null);
  const [alertsState, setAlertsState] = useState<ReadState>('loading');
  // Path Copilot's pending workout changes (flag clientPathCopilot) and their own read state (LO-934 B2, LS-934 B1): a
  // failed re-read keeps the last count and is 'error', so Roman never says nothing waits on a read that did not answer.
  const [path, setPath] = useState<{ n: number | null; state: ReadState; error: unknown; busy: boolean }>({ n: null, state: 'loading', error: null, busy: false });
  const [now, setNow] = useState(() => new Date());
  const seq = useRef(0);
  useEffect(() => () => { seq.current += 1; }, []);

  const loadMonth = useCallback((mine: number) => {
    sources.monthSoFar()
      .then((summary) => { if (mine === seq.current) setMonth({ kind: 'ok', summary }); })
      .catch((err) => { if (mine === seq.current) setMonth({ kind: isSubCoachBillingBlocked(err) ? 'blocked' : 'error' }); });
  }, [sources]);

  // The roster is the shared one the Clients list reads; a failed refresh keeps what it already verified. Needs you
  // counts unread messages, so a failed unread read is a failed read too (LS B1), never "Nobody needs you".
  const loadRoster = useCallback(async (mine: number) => {
    if (!coachId) return;
    const store = useCoachStore.getState();
    if (store.filterStatus === 'archived') { setRosterState('off'); return; }
    const [, u] = await Promise.allSettled([store.loadClients(coachId, 'active', { silent: true }), coachApi.getUnreadCounts()]);
    if (mine !== seq.current) return;
    if (u.status === 'fulfilled') setUnread(((u.value?.data as { by_client?: UnreadByClient } | undefined)?.by_client) ?? {});
    const failed = u.status === 'rejected' || useCoachStore.getState().loadError !== null;
    setRosterState((s) => (failed ? (s === 'ok' ? 'ok' : 'error') : 'ok'));
  }, [coachId]);

  const loadPath = useCallback(async (mine: number, retry = false) => {
    if (!pathCopilot || !sources.pathChangeDrafts) return;
    if (retry) setPath((p) => ({ ...p, busy: true }));
    try {
      const v = await sources.pathChangeDrafts();
      if (mine === seq.current) setPath({ n: v.length, state: 'ok', error: null, busy: false });
    } catch (error) {
      if (mine === seq.current) setPath((p) => ({ n: p.n, state: 'error', error, busy: false }));
    }
  }, [pathCopilot, sources]);

  const load = useCallback(async (isRefresh = false) => {
    const mine = ++seq.current;
    const fresh = () => mine === seq.current;
    setNow(new Date());
    setRefreshing(isRefresh);
    setOverviewFailed(false);
    loadMonth(mine);
    const settle = <T,>(get: () => Promise<T>, write: (v: T) => void, fallback: T) =>
      void Promise.resolve().then(get).catch(() => fallback).then((v) => { if (fresh()) write(v); });
    settle(sources.ltv, setLtv, null);
    settle(sources.nextPayout, setPayout, null);
    settle(sources.atRisk, (v) => setReachOuts(v ?? null), null);
    // An older Home's sources (tests) have no queue: no alerts, as a server with none.
    void Promise.resolve().then(() => sources.actionQueue?.() ?? [])
      .then((v) => { if (fresh()) { setAlerts(v); setAlertsState('ok'); } })
      .catch(() => { if (fresh()) setAlertsState('error'); }); // the rows already verified stay (alerts is not cleared)
    void loadPath(mine);
    void loadRoster(mine);
    try {
      const res = await readOverview();
      if (fresh()) setRead(res);
    } catch {
      if (fresh()) setOverviewFailed(true);
    } finally {
      if (fresh()) setRefreshing(false);
    }
    if (isRefresh) void drafts.refetch();
  }, [drafts, loadMonth, loadRoster, loadPath, readOverview, sources]);

  // Loads on mount and again, without the spinner, on each return to the Home: it stays mounted under its tab
  // (spec item 6, C3). A coach id that arrives later loads the roster then.
  const first = useRef(load);
  first.current = load;
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current && !isFocused) return;
    mounted.current = true;
    void first.current(false);
  }, [isFocused]);
  const rosterOnce = useRef(!!coachId); // a coach id there at mount is in the first load (LO C1)
  useEffect(() => {
    if (!coachId || rosterOnce.current) return;
    rosterOnce.current = true;
    void loadRoster(seq.current);
  }, [coachId, loadRoster]);

  // The tile waits for this phone's block list, as the lookup's Needs you does, so a cold start counts no blocked client (LO B2).
  const blockList = useCoachBlockList();
  const blockedSet = useMemo(() => new Set(blockList.blockedIds), [blockList.blockedIds]);
  const { needs, steady } = useMemo(() => needsAndSteady(clients, unread, now, blockedSet), [clients, unread, now, blockedSet]);
  const areas = useMemo(() => needsYouAreas(needs, unread, alerts, blockedSet), [needs, unread, alerts, blockedSet]);
  const pathOn = pathCopilot && !!sources.pathChangeDrafts;
  const changes = pathOn ? path.n ?? 0 : 0;
  const queue = (drafts.data?.drafts ?? []).filter((d) => isStream2Capability(d.capability));
  const draftKinds: DraftKinds = {
    workouts: queue.filter((d) => d.capability === 'draft.assign_workout').length,
    mealPlans: queue.filter((d) => d.capability === 'draft.assign_meal_plan').length,
    nudges: queue.filter((d) => d.capability === 'draft.send_notification').length,
    // #197-E5: workout-change approvals are tiles in Roman's drafts, counted here once (never in Needs you).
    workoutChanges: changes,
  };
  // The query keeps its last good answer when a refetch fails, so the button stays while that answer stands. Roman's
  // card is 'ok' only once every read it counts has answered: a failed one is 'error', one on its way 'loading'.
  const queueState: ReadState = drafts.data ? 'ok' : drafts.isError ? 'error' : 'loading';
  const pathState: ReadState = pathOn ? path.state : 'ok';
  const draftsState: ReadState = queueState === 'error' || pathState === 'error' ? 'error'
    : queueState === 'loading' || pathState === 'loading' ? 'loading' : 'ok';
  const data: CoachHomeData = {
    overview: read?.overview ?? null, home: read?.home ?? null, overviewFailed, refreshing,
    needs, areas, alertsState, reachOuts, steady, rosterState: rosterState === 'ok' && !blockList.known ? 'loading' : rosterState, ltv, month, payout, unreadNotifications,
    draftsWaiting: queue.length + changes, draftKinds, draftsState, draftsError: queueState === 'error' ? drafts.error : path.error, draftsRetrying: !!drafts.isFetching || path.busy, now,
  };
  return {
    // The Home's one block-list read: the Plan ended list takes this one (usePlanEnded), so a Home mount sends one
    // GET /users/blocks, not two (LO m#866 C1).
    data, blockList, focused: isFocused, reload: load, retryMonth: () => loadMonth(seq.current),
    retryRoster: () => { setRosterState('loading'); void loadRoster(seq.current); },
    // Try again re-reads both of Roman's reads: the drafts queue and the workout changes.
    retryDrafts: async () => { await Promise.all([drafts.refetch(), loadPath(seq.current, true)]); },
  };
}
