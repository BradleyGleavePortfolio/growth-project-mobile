// Coach Command Center — Overview screen.
//
// COACH-HOME-134: the coach Home, built to design-targets/mobile/coach-home-solo
// (date and greeting, one serif hero number only when real, a hairline stat
// row, "Your clients today" most urgent first; every count opens its tab).
//
// State machine:
//   loading → (data | error)
//   Pull-to-refresh transitions refreshing → data/error.
// QA-COACH-HOME-131: the header (setup checklist, Money card) renders in every
// state and mounts once; numbers are ink, and a need is said in words.
//
// Data source: commandCenterApi.getOverview() + coachHomeSources (each read settles on its own).

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { colors, layout, spacing, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  commandCenterApi,
  CommandCenterOverview,
  type AtRiskEntry,
} from '../../../services/commandCenterApi';
import type { MoneyPayout } from '../../../api/coachMoneyApi';
import CoachLtvDashboard, { type LtvMetrics } from '../../../components/command-center/CoachLtvDashboard';
import CommandCenterMockDataBanner from '../../../components/command-center/MockDataBanner';
import LoadFailedNotice from '../../../components/coach/LoadFailedNotice';
import { SkeletonScreen } from '../../../ui/skeletons/Skeleton';
import { QuietOverline, QuietTextButton, TextLink } from '../../../ui';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { isSubCoachBillingBlocked } from '../../../lib/coachSetup/errors';
import type { CoachHomeSources } from './coachHomeSources';
import { clientsNarrative, heroAmount, payoutWords, retentionPct } from './coachHomeCopy';
import { CalmLine, ClientCard, CountRow, EarningsHero, HomeOverline, StatRow, type EarningsState, type StatCell } from './CoachHomeSections';

type LoadState = 'loading' | 'refreshing' | 'data' | 'error';

/** Said under the at-risk number instead of colouring it red. */
function attentionWords(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1 ? 'Needs attention' : 'Need attention';
}

interface Props {
  onNavigateToAtRisk?: () => void;
  onNavigateToWinStreaks?: () => void;
  onNavigateToInbox?: () => void;
  onNavigateToActionQueue?: () => void;
  onSelectClient?: (userId: string, displayName: string) => void;
  onOpenThread?: (clientId: string, clientName: string) => void;
  onOpenMoney?: () => void;
  onOpenClients?: () => void;
  /** S-COACH — Home cards (setup checklist, brief, Money), below today's clients. */
  header?: React.ReactNode;
  /** The hero / payout / retention / urgent reads; CommandCenterScreen passes coachHomeSources. */
  sources?: CoachHomeSources;
}

interface Extras { payout: MoneyPayout | null; ltv: LtvMetrics | null; urgent: AtRiskEntry[] }

export default function OverviewScreen({
  onNavigateToAtRisk,
  onNavigateToWinStreaks,
  onNavigateToInbox,
  onNavigateToActionQueue,
  onSelectClient,
  onOpenThread,
  onOpenMoney,
  onOpenClients,
  header,
  sources,
}: Props) {
  const { semanticColors: sc } = useTheme();
  const user = useCurrentUser();
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CommandCenterOverview | null>(null);
  const [earnings, setEarnings] = useState<EarningsState>({ kind: 'loading' });
  const [extras, setExtras] = useState<Extras>({ payout: null, ltv: null, urgent: [] });
  const [now, setNow] = useState(() => new Date());
  // Only the newest load writes, and nothing writes after unmount.
  const seq = useRef(0);
  useEffect(() => () => { seq.current += 1; }, []);
  const fresh = useCallback((mine: number) => mine === seq.current, []);

  const loadEarnings = useCallback(async (mine: number) => {
    if (!sources) return;
    try {
      const summary = await sources.monthSoFar();
      if (fresh(mine)) setEarnings({ kind: 'ok', summary });
    } catch (err) {
      if (fresh(mine)) setEarnings({ kind: isSubCoachBillingBlocked(err) ? 'blocked' : 'error' });
    }
  }, [fresh, sources]);

  const load = useCallback(async (isRefresh = false) => {
    const mine = ++seq.current;
    setNow(new Date());
    setState(isRefresh ? 'refreshing' : 'loading');
    void loadEarnings(mine);
    if (sources) {
      // Each read settles on its own: a slow one never holds the roster back.
      const keep = <K extends keyof Extras>(key: K, fallback: Extras[K]) => (read: () => Promise<Extras[K]>) =>
        void Promise.resolve().then(read).catch(() => fallback).then((v) => fresh(mine) && setExtras((x) => ({ ...x, [key]: v })));
      keep('payout', null)(sources.nextPayout);
      keep('ltv', null)(sources.ltv);
      keep('urgent', [])(sources.atRisk);
    }
    try {
      const res = await commandCenterApi.getOverview();
      if (!fresh(mine)) return;
      setData(res.data);
      setState('data');
    } catch {
      if (fresh(mine)) setState('error');
    }
  }, [fresh, loadEarnings, sources]);

  useEffect(() => {
    load(false);
  }, [load]);

  const onRefresh = useCallback(() => load(true), [load]);

  const d = data;
  const roster = d?.roster_size ?? 0;
  const checkIn = d ? `${Math.round(d.check_in_rate_7day * 100)}%` : '';
  // Clients first; retention and the next payout only when real; the 7-day
  // check-in rate fills a free cell, otherwise it is a row below.
  const cells: StatCell[] = [];
  if (d && roster > 0) {
    cells.push({ key: 'clients', label: 'Clients', value: String(roster), sub: `${d.active_today} active today`, testID: 'command-center-kpi-roster-size', subTestID: 'command-center-kpi-active-today' });
    const retention = retentionPct(extras.ltv);
    if (retention) cells.push({ key: 'retention', label: 'Retention', value: retention, sub: 'this month', testID: 'coach-home-retention' });
    const p = extras.payout;
    if (p) cells.push({ key: 'payout', label: 'Next payout', value: heroAmount(p.amountCents, p.currency), sub: payoutWords(p, now), testID: 'coach-home-next-payout' });
    if (cells.length < 3) cells.push({ key: 'checkin', label: 'Check-ins', value: checkIn, sub: 'last 7 days', testID: 'command-center-kpi-checkin-rate' });
  }
  const counts = d && (roster > 0 || d.unread_messages > 0 || d.open_alerts > 0) ? [
    { label: 'At risk', n: d.at_risk_count, words: attentionWords(d.at_risk_count), onPress: onNavigateToAtRisk, id: 'at-risk', a11y: `${d.at_risk_count} clients need your attention. View at-risk list.` },
    { label: 'Open alerts', n: d.open_alerts, words: d.open_alerts > 0 ? 'Waiting in Actions' : undefined, onPress: onNavigateToActionQueue, id: 'open-alerts', a11y: `${d.open_alerts} open alerts. View action queue.` },
    { label: 'Unread messages', n: d.unread_messages, words: undefined, onPress: onNavigateToInbox, id: 'unread-messages', a11y: `${d.unread_messages} unread messages. View inbox.` },
    { label: 'Active streaks', n: d.win_streak_count, words: undefined, onPress: onNavigateToWinStreaks, id: 'win-streaks', a11y: `${d.win_streak_count} clients on active streaks. View win streaks.` },
  ] : [];
  const urgent = roster > 0 && (d?.at_risk_count ?? 0) > 0 ? extras.urgent.slice(0, 3) : [];
  const earned = earnings.kind === 'ok' && (earnings.summary.totals.chargeCount > 0 || cells.length > 0);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: sc.bgPrimary }]}
      contentContainerStyle={styles.content}
      testID="command-center-overview"
      refreshControl={
        <RefreshControl
          refreshing={state === 'refreshing'}
          onRefresh={onRefresh}
          tintColor={colors.forest}
        />
      }
    >
      <CommandCenterMockDataBanner />
      <HomeOverline firstName={user?.firstName ?? user?.name} now={now} />
      <EarningsHero state={earnings} now={now} onRetry={() => void loadEarnings(seq.current)} />
      {cells.length > 0 ? <StatRow cells={cells} /> : null}
      {earned && onOpenMoney ? <TextLink label="See full earnings" onPress={onOpenMoney} size="small" testID="coach-home-see-earnings" /> : null}

      <View style={styles.section}>
        <QuietOverline accessibilityRole="header">Your clients today</QuietOverline>
        {state === 'error' && d === null ? (
          <LoadFailedNotice message="Roster numbers could not load." onRetry={() => load(false)} testID="command-center-overview-error" />
        ) : d === null ? (
          <SkeletonScreen count={3} testID="command-center-overview-loading" />
        ) : roster === 0 ? (
          <CalmLine title="No clients yet." detail="When a client joins, the one who needs you most shows here first." testID="coach-home-clients-empty" />
        ) : (
          <Text style={[styles.narrative, { color: sc.textPrimary }]}>{clientsNarrative(roster, d.at_risk_count)}</Text>
        )}
        {d && roster === 0 && onOpenClients ? <QuietTextButton label="Go to Clients" onPress={onOpenClients} testID="coach-home-go-clients" /> : null}
        {urgent.map((e, i) => (
          <ClientCard
            key={e.user_id} entry={e} now={now} urgent={i === 0}
            onOpen={() => onSelectClient?.(e.user_id, e.display_name)} onMessage={() => onOpenThread?.(e.user_id, e.display_name)}
          />
        ))}
        {counts.length > 0 ? <View style={styles.counts}>
          {counts.map((c) => (
            <CountRow key={c.id} label={c.label} value={String(c.n)} words={c.words} onPress={c.onPress} accessibilityLabel={c.a11y} testID={`command-center-kpi-${c.id}`} />
          ))}
          {d && roster > 0 && !cells.some((c) => c.key === 'checkin') ? (
            <CountRow label="Check-ins, last 7 days" value={checkIn} accessibilityLabel={`Check-in rate (7 days): ${checkIn}`} testID="command-center-kpi-checkin-rate" />
          ) : null}
        </View> : null}
        {roster > 0 && onOpenClients ? <TextLink label={`View all ${roster}`} onPress={onOpenClients} size="small" testID="coach-home-view-all" /> : null}
      </View>

      {header}

      {/* ── Revenue & LTV dashboard, once there are clients to measure ───── */}
      {/* Added: feat/coach-ltv-dashboard — see CoachLtvDashboard.tsx */}
      {d !== null && roster > 0 ? (
        <View style={[styles.ltvSection, { borderTopColor: sc.border }]}>
          <CoachLtvDashboard
            apiGet={(_path: string) => commandCenterApi.getLtvMetrics()}
            inlineMode
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  section: { marginTop: 36, marginBottom: layout.sectionGap },
  narrative: { ...typography.h1, marginTop: 4, marginBottom: 20 },
  counts: { marginTop: 8 },
  ltvSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
