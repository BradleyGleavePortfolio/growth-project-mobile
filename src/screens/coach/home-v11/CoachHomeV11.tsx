/**
 * The coach Home (spec #688 6295886580, Style A of planning/MOCKUP3/HOME3), behind featureFlags.coachHomeV11. Hero:
 * date, bell, gear, setup checklist until done, "{n} wins this week" (opens the wins list) with three wins, tiles,
 * Open alerts, the day's rings. Page: push ask and brief, Roman, one Needs you tile, Business, Clients rows. Only real
 * numbers: a server without b#1123's `home` gets the hero and tiles from the overview, and no rings.
 */
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, layout, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../../ui/states/QuietStates';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { rosterDisplayName } from '../../../utils/coach/clientRoster';
import { formatCount } from '../../../components/home/rings/homeRings';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { dateOverline, heroAmount, monthOverline, paceLine, payoutWords, retentionPct } from '../command-center/coachHomeCopy';
import { hasMonthMoney } from '../command-center/CoachHomeSections';
import { AlertsRow, DayRing, LinkRow, MiniTile, SEMI, useCardStyles } from './HomeParts';
import { ListSheet, RomanDraftSheet, reachOutAsk, type DraftAsk, type ListRow } from './DraftSheets';
import { firstWord, pct, ringSpecs, ringsCaption, winLine, winWindow, winsHeadline, type HomeWin } from './homeDay';
import { useCoachHomeV11 } from './useCoachHomeV11';

/** Reach-outs: the ring's goal is at most five of the at-risk set (b#1123), so the sheet offers its five most urgent. */
const REACH_ROWS = 5;
const WIN_TURN_MS = 6000;

type Go = () => void;
interface Props {
  onOpenNeedsYou: Go; onOpenClients: Go; onOpenStreaks: Go; onOpenAlerts: Go; onOpenMoney: Go; onOpenDrafts: Go; onOpenNotifications: Go; onOpenSettings: Go;
  /** Only when Roman's coach chat is on. */
  onAskRoman?: Go;
  /** The setup checklist (CoachHomeCards 'setup'), on the hero until setup is done. */
  setup?: React.ReactNode;
  /** The push ask and brief (CoachHomeCards 'below'); `zero`: no clients, so no brief (#161-16, ruling 6296068749). */
  belowHero?: (zero: boolean) => React.ReactNode;
  sources?: CoachHomeSources;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Three wins at a time; with more, the window moves on every few seconds unless motion or a screen reader is off-limits. */
function useWinTurn(n: number) {
  const [turn, setTurn] = useState(0);
  const [still, setStill] = useState(true);
  useEffect(() => {
    let live = true;
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()])
      .then(([rm, sr]) => { if (live) setStill(rm || sr); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (still || n <= 3) return undefined;
    const t = setInterval(() => setTurn((x) => x + 1), WIN_TURN_MS);
    return () => clearInterval(t);
  }, [still, n]);
  return turn;
}

export default function CoachHomeV11(p: Props) {
  const { colors, semanticColors: sc } = useTheme();
  const cs = useCardStyles();
  const { top, bottom } = useScreenInsets();
  const { data, reload, retryMonth, retryRoster, retryDrafts } = useCoachHomeV11(p.sources);
  const [ask, setAsk] = useState<DraftAsk | null>(null);
  const [list, setList] = useState<'wins' | 'reach' | null>(null);
  const o = data.overview;
  const home = data.home;
  const roster = o?.roster_size ?? 0;
  const rosterN = formatCount(roster);
  const items = home?.wins.items ?? [];
  const turn = useWinTurn(items.length);
  const wins = winWindow(items, turn);
  const bell = data.unreadNotifications;
  const rings = home?.rings ? ringSpecs(home.rings) : null;
  const retention = retentionPct(data.ltv);
  const checkIns = o ? pct(o.check_in_rate_7day) : null;
  const monthOk = data.month.kind === 'ok' ? data.month.summary : null;

  const askWin = (w: HomeWin) => setAsk({ clientName: w.client_name, about: `A congratulations for ${firstWord(w.client_name)}: ${winLine(w)}.`, request: w.draft });
  const winLabel = (w: HomeWin) => `${winLine(w)}. Ask Roman to congratulate ${firstWord(w.client_name)}`;
  const reach = (data.reachOuts ?? []).slice(0, REACH_ROWS);
  const pick = (go: () => void) => () => { setList(null); go(); };
  const rows: ListRow[] | null = list === 'wins'
    ? items.map((w) => ({ id: w.id, title: winLine(w), label: winLabel(w), onPick: pick(() => askWin(w)) }))
    : list === 'reach'
      ? reach.map((r) => ({ id: r.user_id, title: `Reach out to ${r.display_name}?`, line: r.top_factor, label: `Reach out to ${r.display_name}?`, onPick: pick(() => setAsk(reachOutAsk(r))) }))
      : null;
  const tap = (go: () => void) => () => { void HapticService.softImpact(); go(); };

  const hero = (() => {
    if (!o && data.overviewFailed) {
      return (
        <View style={s.heroBlock}>
          <Text style={s.onDeep}>Your numbers did not load.</Text>
          <Pressable style={s.retry} onPress={() => void reload(false)} accessibilityRole="button" accessibilityLabel="Try again" testID="home-retry">
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    if (!o) return <View style={s.heroBlock} accessible accessibilityLabel="Loading" testID="home-loading"><Text style={s.onDeepMuted}>Loading your day</Text></View>;
    if (roster === 0) {
      return (
        <View style={s.heroBlock} testID="home-hero-zero">
          <View style={s.heroLine}><Text style={s.heroValue}>0</Text><Text style={s.heroUnit}>clients · None yet</Text></View>
          <View style={s.bar} />
        </View>
      );
    }
    if (home) {
      const h = winsHeadline(home.wins.count);
      return (
        <View style={s.heroBlock} testID="home-hero-wins">
          <Pressable
            style={({ pressed }) => [s.heroLine, pressed && s.pressed]} disabled={items.length === 0} onPress={tap(() => setList('wins'))}
            accessibilityRole={items.length > 0 ? 'button' : 'header'} accessibilityLabel={`${h.value} ${h.unit}${items.length > 0 ? '. See all' : ''}`} testID="home-wins-all"
          >
            <Text style={s.heroValue}>{h.value}</Text><Text style={s.heroUnit}>{h.unit}</Text>
            {items.length > 0 ? <Ionicons name="chevron-forward" size={22} color={forestPop.onDeepMuted} /> : null}
          </Pressable>
          {wins.length === 0 ? (
            <Text style={s.onDeepMuted}>{home.wins.count === 0 ? 'Wins show here as your clients hit them.' : 'Pull down to see them.'}</Text>
          ) : wins.map((w) => (
            <Pressable key={w.id} style={({ pressed }) => [s.win, pressed && s.pressed]} onPress={() => askWin(w)} accessibilityRole="button" accessibilityLabel={winLabel(w)} testID={`home-win-${w.id}`}>
              <View style={s.winDot} />
              <Text style={s.winText} numberOfLines={2}>{winLine(w)}</Text>
              <Ionicons name="chevron-forward" size={18} color={forestPop.onDeepMuted} />
            </Pressable>
          ))}
        </View>
      );
    }
    // No `home` from this server: the overview's own figure, as the Home drew it before (no new number).
    const share = Math.min(1, o.active_today / roster);
    return (
      <View style={s.heroBlock} testID="home-hero-today">
        <View style={s.heroLine}>
          <Text style={s.heroValue}>{formatCount(o.active_today)}</Text><Text style={s.heroUnit}>of {rosterN}</Text>
          <Text style={s.heroRight}>ACTIVE TODAY</Text>
        </View>
        <View style={s.bar}><View style={[s.barFill, { width: `${share * 100}%` }]} /></View>
      </View>
    );
  })();

  const tiles = o && roster > 0 ? (
    <View style={s.tiles} testID="home-tiles">
      {home ? <MiniTile value={formatCount(o.active_today)} label={`of ${rosterN} active today`} testID="home-tile-active" /> : null}
      {checkIns ? <MiniTile value={checkIns} label="check-ins · last 7 days" testID="home-tile-checkins" /> : null}
      {retention ? <MiniTile value={retention} label="stayed · this month" testID="home-tile-stayed" /> : null}
    </View>
  ) : null;

  const needsTile = (() => {
    const n = data.needs.length;
    const box = (value: string | null) => (
      <View style={s.needsBox}>
        {value === null ? <Ionicons name="people-outline" size={30} color={forestPop.leaf} /> : <Text style={s.needsNum} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>}
      </View>
    );
    if (data.rosterState === 'error' && n === 0) {
      return <View style={cs.card}><QuietError layout="inline" message="Who needs you could not load." onRetry={retryRoster} testID="home-needs-error" /></View>;
    }
    if (data.rosterState === 'loading' && n === 0) {
      return <View style={cs.card}><QuietLoading label="Loading who needs you" rows={1} testID="home-needs-loading" /></View>;
    }
    if (o && roster === 0) {
      return (
        <View style={[cs.card, s.needs]} testID="home-needs">
          {box('0')}
          <View style={s.grow}><Text style={cs.title}>Needs you, 0</Text><Text style={cs.body}>Clients who need you show here, most urgent first.</Text></View>
        </View>
      );
    }
    const lead = data.needs[0];
    const leadName = lead ? rosterDisplayName(lead.client) : '';
    const off = data.rosterState === 'off';
    const label = off ? 'Needs you. Open the list' : n === 0 ? 'Needs you, 0. Nobody needs you right now' : `Needs you, ${n}. ${leadName}, ${lead.reason.text}${n > 1 ? `, and ${n - 1} more` : ''}`;
    return (
      <Pressable style={({ pressed }) => [cs.card, s.needs, pressed && s.pressed]} onPress={tap(p.onOpenNeedsYou)} accessibilityRole="button" accessibilityLabel={label} testID="home-needs">
        {box(off ? null : String(n))}
        <View style={s.grow}>
          <Text style={cs.title}>{off ? 'Needs you' : `Needs you, ${n}`}</Text>
          {off ? <Text style={cs.body}>Open the list</Text> : n === 0 ? <Text style={cs.body}>Nobody needs you right now.</Text> : (
            <Text style={cs.body}>
              <Text style={s.bold}>{leadName}</Text>{` · ${lead.reason.text}`}{n > 1 ? <Text style={s.bold}>{`  +${n - 1} more`}</Text> : null}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>
    );
  })();

  const roman = (() => {
    const n = data.draftsWaiting;
    const k = data.draftKinds;
    const chips = ([[k.workouts, 'Workout', 'Workouts'], [k.mealPlans, 'Meal plan', 'Meal plans'], [k.nudges, 'Nudge', 'Nudges']] as const)
      .filter(([c]) => c > 0).map(([c, one, many]) => [c, c === 1 ? one : many] as const);
    return (
      <View style={cs.card} testID="home-roman">
        <View style={s.romanHead}>
          <RomanAvatar crop="monogram" size={48} />
          <View style={s.grow}>
            <Text style={cs.title}>{n > 0 ? `Roman has ${n} ${n === 1 ? 'draft' : 'drafts'} ready` : 'Roman'}</Text>
            {data.draftsState === 'ok' && n === 0 ? (
              <Text style={cs.body}>{roster === 0 ? 'Roman drafts replies and workout changes for you once clients join.' : 'Nothing to approve right now.'}</Text>
            ) : null}
          </View>
        </View>
        {data.draftsState === 'loading' ? <QuietLoading label="Loading Roman's drafts" rows={1} testID="home-drafts-loading" /> : null}
        {data.draftsState === 'error' ? (
          <QuietError layout="inline" message={loadFailureMessage(data.draftsError, "Roman's drafts")} onRetry={retryDrafts} retrying={data.draftsRetrying} testID="home-drafts-error" />
        ) : null}
        {chips.length > 0 ? (
          <View style={s.chips}>
            {chips.map(([c, label]) => (
              <View key={label} style={[s.chip, { backgroundColor: sc.bgPrimary }]}><Text style={cs.strong}>{c} <Text style={cs.body}>{label}</Text></Text></View>
            ))}
          </View>
        ) : null}
        {n > 0 ? (
          <Pressable
            onPress={() => { void HapticService.mediumImpact(); p.onOpenDrafts(); }} accessibilityRole="button"
            accessibilityLabel={`Approve Roman's drafts, ${n}`} testID="home-drafts"
            style={({ pressed }) => [s.approve, { backgroundColor: sc.accent }, pressed && s.pressed]}
          >
            <Text style={[s.approveText, { color: sc.textOnAccent }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>{"Approve Roman's drafts\u00a0→"}</Text>
            <View style={s.approveBadge}><Text style={s.approveBadgeText} maxFontSizeMultiplier={1.2}>{n}</Text></View>
          </Pressable>
        ) : null}
        {p.onAskRoman ? (
          <Pressable style={s.askRoman} onPress={tap(p.onAskRoman)} accessibilityRole="button" accessibilityLabel="Ask Roman" testID="home-ask-roman">
            <Text style={[cs.strong, { color: sc.accentText }]}>Ask Roman</Text>
          </Pressable>
        ) : null}
      </View>
    );
  })();

  const business = (() => {
    if (data.month.kind === 'blocked') return null;
    const pace = monthOk && hasMonthMoney(monthOk) ? paceLine(monthOk.totals.netCents, monthOk.currency, data.now) : null;
    return (
      <View testID="home-business">
        <Text style={cs.section} accessibilityRole="header">BUSINESS</Text>
        {data.month.kind === 'error' ? (
          <View style={cs.card}><QuietError layout="inline" message="This month's earnings could not load." onRetry={retryMonth} testID="home-month-error" /></View>
        ) : data.month.kind === 'loading' ? (
          <View style={cs.card}><QuietLoading label="Loading earnings" rows={1} testID="home-month-loading" /></View>
        ) : monthOk ? (
          <Pressable style={({ pressed }) => [cs.card, s.biz, pressed && s.pressed]} onPress={tap(p.onOpenMoney)} accessibilityRole="button" accessibilityLabel={`Earnings this month, ${heroAmount(monthOk.totals.netCents, monthOk.currency)}`} testID="home-month">
            <View style={s.bizMark}><Text style={s.bizSign}>$</Text></View>
            <View style={s.grow}>
              <Text style={cs.body}>Earnings · this month</Text>
              <Text style={s.bizAmount} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>{heroAmount(monthOk.totals.netCents, monthOk.currency)}</Text>
              <Text style={cs.body}>{pace ? `${monthOverline(data.now)} · ${pace}` : hasMonthMoney(monthOk) ? monthOverline(data.now) : 'Nothing earned yet this month.'}</Text>
              {data.payout ? <Text style={cs.body}>{`Next payout ${heroAmount(data.payout.amountCents, data.payout.currency)} · ${cap(payoutWords(data.payout, data.now))}`}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    );
  })();

  const clientsCard = o && roster > 0 ? (
    <View testID="home-clients">
      <Text style={cs.section} accessibilityRole="header">CLIENTS</Text>
      <View style={[cs.card, s.flush]}>
        <LinkRow first title={`All ${rosterN} clients`} line="Open Clients" onPress={tap(p.onOpenClients)} testID="home-row-all" />
        {data.rosterState === 'ok' ? (
          <LinkRow
            title={`Steady, ${data.steady.count}`} line={data.steady.loggedToday !== null ? `${data.steady.loggedToday} logged today` : null}
            onPress={tap(p.onOpenClients)} testID="home-row-steady"
          />
        ) : null}
        <LinkRow title="Streaks" count={o.win_streak_count} onPress={tap(p.onOpenStreaks)} testID="home-row-streaks" />
      </View>
    </View>
  ) : null;

  return (
    <View style={[s.fill, { backgroundColor: sc.bgPrimary }]}>
      <ScrollView
        style={s.fill} contentContainerStyle={{ paddingBottom: 32 + bottom }} testID="coach-home-v11"
        refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => void reload(true)} tintColor={sc.accent} />}
      >
        <View style={[s.hero, { paddingTop: top + 12 }]} testID="home-hero">
          <View style={s.topRow}>
            <Text style={s.date} maxFontSizeMultiplier={1.3}>{dateOverline(data.now).toUpperCase()}</Text>
            <Pressable
              onPress={tap(p.onOpenNotifications)} hitSlop={8} style={s.icon} testID="home-bell"
              accessibilityRole="button" accessibilityLabel={bell > 0 ? `Notifications, ${bell > 99 ? '99+' : bell} unread` : 'Notifications'}
            >
              <Ionicons name="notifications-outline" size={26} color={forestPop.onDeep} />
              {bell > 0 ? <View style={s.bellBadge}><Text style={s.bellBadgeText} maxFontSizeMultiplier={1.2}>{bell > 99 ? '99+' : bell}</Text></View> : null}
            </Pressable>
            <Pressable onPress={tap(p.onOpenSettings)} hitSlop={8} style={s.icon} accessibilityRole="button" accessibilityLabel="Settings" testID="home-gear">
              <Ionicons name="settings-outline" size={26} color={forestPop.onDeep} />
            </Pressable>
          </View>
          {/* The checklist hides itself once setup is done. */}
          {p.setup}
          {hero}
          {tiles}
          {o ? <AlertsRow count={o.open_alerts} onPress={tap(p.onOpenAlerts)} /> : null}
          {o && rings ? (
            <View testID="home-rings">
              <Text style={s.dayLabel} accessibilityRole="header">YOUR DAY</Text>
              <View style={s.rings}>
                {rings.map((r) => (
                  // Reach-outs opens its own at-risk list, only when the ring has a goal and the list has someone in it.
                  <DayRing key={r.key} ring={r} onPress={r.key === 'reach_outs' && r.of > 0 && reach.length > 0 ? tap(() => setList('reach')) : undefined} />
                ))}
              </View>
              <Text style={s.onDeepMuted}>{ringsCaption(rings, roster)}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.page}>
          {p.belowHero?.(!!o && roster === 0)}
          {roman}
          {needsTile}
          {business}
          {clientsCard}
        </View>
      </ScrollView>
      <ListSheet title={list === 'wins' ? 'Wins this week' : 'Reach-outs'} rows={rows} onClose={() => setList(null)} />
      <RomanDraftSheet ask={ask} onClose={() => setAsk(null)} onSent={() => void reload(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  hero: { backgroundColor: forestPop.deep, paddingHorizontal: layout.gutter, paddingBottom: 24, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 },
  date: { ...typography.caption, fontFamily: SEMI, letterSpacing: 1.6, color: forestPop.onDeepMuted, flex: 1 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: -2, right: -10, minWidth: 22, height: 22, borderRadius: radius.chip, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: forestPop.leaf },
  bellBadgeText: { ...typography.caption, fontSize: 12, lineHeight: 15, letterSpacing: 0, fontFamily: SEMI, color: forestPop.deep },
  heroBlock: { gap: 6 },
  heroLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  heroValue: { fontFamily: SEMI, fontSize: 56, lineHeight: 64, letterSpacing: -1, color: forestPop.onDeep },
  heroUnit: { ...typography.body, fontSize: 20, lineHeight: 26, color: forestPop.onDeep, flexShrink: 1 },
  heroRight: { ...typography.caption, fontFamily: SEMI, letterSpacing: 1.6, color: forestPop.onDeepMuted, marginLeft: 'auto' },
  bar: { height: 8, borderRadius: radius.chip, backgroundColor: forestPop.forest, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: radius.chip, backgroundColor: forestPop.leaf },
  win: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  winDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: forestPop.leaf },
  winText: { ...typography.body, color: forestPop.onDeep, flex: 1 },
  onDeep: { ...typography.body, color: forestPop.onDeep },
  onDeepMuted: { ...typography.bodySmall, color: forestPop.onDeepMuted },
  retry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.button, borderWidth: 1, borderColor: forestPop.brand400 },
  retryText: { ...typography.bodyMd, color: forestPop.onDeep },
  tiles: { flexDirection: 'row', gap: 10 },
  dayLabel: { ...typography.caption, fontFamily: SEMI, letterSpacing: 1.6, color: forestPop.gold, marginBottom: 8 },
  rings: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  page: { paddingHorizontal: layout.gutter, paddingTop: 16, gap: 14 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontFamily: SEMI },
  needs: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  needsBox: { width: 72, height: 72, borderRadius: radius.card, backgroundColor: forestPop.deep, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  needsNum: { fontFamily: SEMI, fontSize: 30, lineHeight: 36, color: forestPop.leaf },
  romanHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { minHeight: 40, borderRadius: radius.button, paddingHorizontal: 12, justifyContent: 'center' },
  approve: { minHeight: 56, marginTop: 14, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  approveText: { ...typography.bodyMd, fontSize: 18, lineHeight: 24, flexShrink: 1, textAlign: 'center' },
  approveBadge: { minWidth: 28, height: 28, borderRadius: radius.chip, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: forestPop.leaf },
  approveBadgeText: { ...typography.bodyMd, fontSize: 15, lineHeight: 18, color: forestPop.deep },
  askRoman: { minHeight: 44, alignSelf: 'flex-end', justifyContent: 'center', marginTop: 6 },
  biz: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bizMark: { width: 52, height: 52, borderRadius: radius.button, backgroundColor: forestPop.deep, alignItems: 'center', justifyContent: 'center' },
  bizSign: { fontFamily: SEMI, fontSize: 24, lineHeight: 30, color: forestPop.leaf },
  bizAmount: { fontFamily: SEMI, fontSize: 30, lineHeight: 38, color: forestPop.ink },
  flush: { padding: 0 },
  pressed: { opacity: 0.7 },
});
