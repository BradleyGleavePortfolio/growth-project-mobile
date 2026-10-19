/**
 * UI-2 coach Home (V1_1_UI_SPEC UI-2, owner 10-09 "render 2"), behind featureFlags.coachHomeV11: the date and
 * bell, three dials, Roman with the one action "Approve Roman's drafts →", the clients who need the coach as
 * tiles, and Business. Only real numbers are drawn; a dial with no real base is left out. Zero clients: the
 * Clients and Earnings dials, then the existing setup cards (`header`). The chips filter the roster section:
 * Needs you (tiles, then the Steady wall, as in the mockup), Steady (the wall) and Streaks (streak tiles).
 * C-S-PUSH-3: Overview is the landing with this Home on (coachLanding.ts), so it carries the coach's push ask:
 * in `header` at zero clients, else between the roster section and Business, as on today's Overview.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { QuietOverline, TextLink } from '../../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../../ui/states/QuietStates';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import PushPermissionCard from '../../../components/home/PushPermissionCard';
import { HapticService } from '../../../ui/haptics/haptics.service';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { dateOverline, heroAmount, lastActiveWords, monthOverline, paceLine, payoutWords, retentionPct } from '../command-center/coachHomeCopy';
import { hasMonthMoney } from '../command-center/CoachHomeSections';
import { AllClientsTile, BusinessTile, ClientTile, HomeDial, type DialSpec } from './HomeParts';
import { useCoachHomeV11, type CoachHomeData } from './useCoachHomeV11';
import { FilterChips, SteadyWall } from './RosterParts';
import { filterChips, loggedLine, steadyWall, streakLabel, type RosterFilter } from './rosterWall';
import type { RosterSources } from './rosterSources';
import { useRosterWall } from './useRosterWall';

const TILE_GAP = 12;
/** Seven clients and the "All clients" tile fill four rows, as in the mockup. */
const MAX_TILES = 7;

interface Props {
  onSelectClient: (clientId: string, clientName: string) => void;
  onOpenClients: () => void;
  onOpenMoney: () => void;
  onOpenDrafts: () => void;
  onOpenNotifications: () => void;
  /** Only when Roman's coach chat is on. */
  onAskRoman?: () => void;
  /** Zero clients: the existing setup checklist and Money card. */
  header?: React.ReactNode;
  sources?: CoachHomeSources;
  rosterSources?: RosterSources;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "$0", as in the mockup, rather than "$0.00". */
function amount(cents: number, currency: string): string {
  if (cents !== 0) return heroAmount(cents, currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(0);
  } catch {
    return heroAmount(0, currency);
  }
}

export function homeDials(d: CoachHomeData): DialSpec[] {
  const o = d.overview;
  if (!o) return [];
  if (o.roster_size === 0) {
    const dials: DialSpec[] = [{ key: 'clients', value: '0', unit: 'clients', label: 'Clients', sub: 'None yet', progress: 0 }];
    if (d.month.kind === 'ok') {
      const { totals, currency } = d.month.summary;
      dials.push({ key: 'earnings', value: amount(totals.netCents, currency), unit: 'this month', label: 'Earnings', sub: monthOverline(d.now), progress: 0 });
    }
    return dials;
  }
  const rate = Math.max(0, Math.min(1, o.check_in_rate_7day));
  const dials: DialSpec[] = [
    { key: 'today', value: String(o.active_today), unit: `of ${o.roster_size}`, label: 'Today', progress: o.active_today / o.roster_size },
    { key: 'checkins', value: `${Math.round(rate * 100)}%`, unit: 'check-ins', label: 'Check-ins', sub: 'Last 7 days', progress: rate },
  ];
  const retention = retentionPct(d.ltv);
  if (retention) dials.push({ key: 'retention', value: retention, unit: 'stayed', label: 'Retention', sub: 'This month', progress: parseInt(retention, 10) / 100 });
  return dials;
}

export default function CoachHomeV11({ onSelectClient, onOpenClients, onOpenMoney, onOpenDrafts, onOpenNotifications, onAskRoman, header, sources, rosterSources }: Props) {
  const { semanticColors: sc } = useTheme();
  const { width } = useWindowDimensions();
  const { data, reload, retryMonth, retryUrgent, retryDrafts } = useCoachHomeV11(sources);
  const { roster: rw, reloadRoster } = useRosterWall(rosterSources);
  const [picked, setPicked] = useState<RosterFilter | null>(null);
  const contentWidth = Math.min(width, 600) - 2 * layout.gutter;
  const tileWidth = (contentWidth - TILE_GAP) / 2;
  const o = data.overview;
  const roster = o?.roster_size ?? 0;
  const dials = homeDials(data);
  const needsYou = roster > 0 && (o?.at_risk_count ?? 0) > 0;
  const urgent = needsYou ? data.urgent.slice(0, MAX_TILES) : [];
  const bell = data.unreadNotifications;
  const byId = useMemo(() => new Map((rw.clients ?? []).map((c) => [c.id, c])), [rw.clients]);
  // The wall and the chips wait for the needs-you list, so a client who needs the coach is never drawn as steady.
  const urgentReady = !needsYou || (data.urgentState === 'ok' && data.urgent.length > 0);
  const wallReady = rw.clients !== null && roster > 0 && urgentReady;
  const wall = useMemo(
    () => (wallReady && rw.clients ? steadyWall(rw.clients, new Set(data.urgent.map((e) => e.user_id)), data.now) : null),
    [wallReady, rw.clients, data.urgent, data.now],
  );
  const streaks = rw.streaks.slice(0, MAX_TILES);
  // The chips arrive together, once every read behind them has answered, so the section never jumps.
  const chips = roster > 0 && rw.settled && urgentReady
    ? filterChips(
      urgent.length > 0 ? (o?.at_risk_count ?? 0) : 0,
      wall ? wall.length : null,
      streaks.length > 0 ? Math.max(o?.win_streak_count ?? 0, rw.streaks.length) : 0,
    )
    : [];
  const filter: RosterFilter | null = chips.find((c) => c.key === picked)?.key ?? chips[0]?.key ?? null;
  const showWall = wall !== null && wall.length > 0 && (filter === 'needs' || filter === 'steady');

  return (
    <ScrollView
      style={{ backgroundColor: sc.bgPrimary }} contentContainerStyle={styles.content} testID="coach-home-v11"
      refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => { void reload(true); reloadRoster(); }} tintColor={sc.accent} />}
    >
      <View style={styles.topRow}>
        <QuietOverline style={styles.flat} maxFontSizeMultiplier={1.3}>{dateOverline(data.now)}</QuietOverline>
        <Pressable
          onPress={() => { void HapticService.softImpact(); onOpenNotifications(); }} hitSlop={8}
          accessibilityRole="button" accessibilityLabel={bell > 0 ? `Notifications, ${bell > 99 ? '99+' : bell} unread` : 'Notifications'}
          style={styles.bell} testID="coach-home-v11-bell"
        >
          <Ionicons name="notifications-outline" size={24} color={sc.textPrimary} />
          {bell > 0 ? (
            <View style={[styles.badge, styles.bellBadge, { backgroundColor: sc.accent, borderColor: sc.bgPrimary }]}>
              <Text style={[styles.badgeText, { color: sc.textOnAccent }]} maxFontSizeMultiplier={1.2}>{bell > 99 ? '99+' : bell}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {o === null && data.overviewFailed ? (
        <QuietError message="Roster numbers could not load." onRetry={() => void reload(false)} testID="coach-home-v11-error" />
      ) : o === null ? (
        <QuietLoading label="Loading" testID="coach-home-v11-loading" />
      ) : (
        <View style={styles.dials} testID="coach-home-v11-dials">
          {dials.map(({ key, ...dial }) => <HomeDial key={key} {...dial} testID={`coach-home-v11-dial-${key}`} />)}
        </View>
      )}

      {data.draftsWaiting > 0 || onAskRoman || data.draftsState !== 'ok' ? (
        <View style={[styles.roman, { borderColor: sc.border }]} testID="coach-home-v11-roman">
          <View style={styles.romanMark}><RomanAvatar crop="monogram" size={28} /></View>
          <View style={styles.grow}>
            {data.draftsState === 'loading' ? (
              <View style={styles.wide}><QuietLoading label="Loading pending drafts" rows={1} testID="coach-home-v11-drafts-loading" /></View>
            ) : data.draftsState === 'error' ? (
              <QuietError
                layout="inline" message={loadFailureMessage(data.draftsError, 'Pending AI drafts')} onRetry={retryDrafts}
                retrying={data.draftsRetrying} testID="coach-home-v11-drafts-error"
              />
            ) : data.draftsWaiting > 0 ? (
              <Pressable
                onPress={() => { void HapticService.mediumImpact(); onOpenDrafts(); }}
                accessibilityRole="button" accessibilityLabel={`Approve Roman's drafts, ${data.draftsWaiting}`} testID="coach-home-v11-drafts"
                style={({ pressed }) => [styles.drafts, { backgroundColor: sc.accent }, pressed && styles.pressed]}
              >
                <Text style={[styles.draftsLabel, { color: sc.textOnAccent }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                  {/* A no-break space keeps the arrow beside "drafts" when large text wraps the label. */}
                  {"Approve Roman's drafts\u00a0→"}
                </Text>
                <View style={[styles.badge, { backgroundColor: sc.textOnAccent }]}>
                  <Text style={[styles.badgeText, { color: sc.accent }]} maxFontSizeMultiplier={1.2}>{data.draftsWaiting}</Text>
                </View>
              </Pressable>
            ) : null}
            {onAskRoman ? (
              <TextLink label="Ask Roman" tone="accent" underline={false} align="start" size="small" testID="coach-home-v11-ask-roman"
                onPress={() => { void HapticService.softImpact(); onAskRoman(); }} />
            ) : null}
          </View>
        </View>
      ) : null}

      {o && roster === 0 ? <View style={styles.section}>{header}</View> : null}

      {o && roster > 0 ? (
        <View style={styles.rosterSection} testID="coach-home-v11-roster">
          {chips.length > 0 ? <FilterChips chips={chips} selected={filter} onSelect={setPicked} /> : null}
          {needsYou && data.urgentState === 'loading' ? <QuietLoading label="Loading" rows={2} testID="coach-home-v11-urgent-loading" /> : null}
          {needsYou && data.urgentState === 'error' ? (
            <QuietError layout="inline" message="At-risk clients could not load." onRetry={retryUrgent} testID="coach-home-v11-urgent-error" />
          ) : null}
          {filter !== 'steady' ? (
            <View style={styles.rosterTiles}>
              {filter === 'streaks'
                ? streaks.map((e) => (
                  <ClientTile
                    key={e.user_id} name={e.display_name} line={streakLabel(e)} reason={`${e.streak_days} days`} unread={rw.unread[e.user_id]}
                    width={tileWidth} onPress={() => onSelectClient(e.user_id, e.display_name)} testID={`coach-home-v11-streak-${e.user_id}`}
                  />
                ))
                : urgent.map((e) => (
                  <ClientTile
                    key={e.user_id} name={e.display_name} reason={e.top_factor} unread={rw.unread[e.user_id]}
                    line={loggedLine(byId.get(e.user_id), data.now) ?? lastActiveWords(e.last_active_at, data.now)}
                    width={tileWidth} onPress={() => onSelectClient(e.user_id, e.display_name)} testID={`coach-home-v11-client-${e.user_id}`}
                  />
                ))}
              <AllClientsTile count={roster} width={tileWidth} onPress={onOpenClients} />
            </View>
          ) : null}
          {showWall && wall ? (
            <SteadyWall
              members={wall} width={contentWidth} total={roster} flushTop={filter === 'steady'}
              onSelect={onSelectClient} onOpenClients={onOpenClients}
            />
          ) : null}
        </View>
      ) : null}

      {o && roster > 0 ? (
        <View style={styles.section}>
          <PushPermissionCard audience="coach" presentation="section" />
          {data.month.kind !== 'loading' || data.payout ? (
            <View testID="coach-home-v11-business">
              <QuietOverline accessibilityRole="header">Business</QuietOverline>
              {data.month.kind === 'error' ? (
                <QuietError message="This month's earnings could not load." onRetry={retryMonth} testID="coach-home-v11-month-error" />
              ) : null}
              <View style={styles.tiles}>
                {data.month.kind === 'ok' && hasMonthMoney(data.month.summary) ? (
                  <BusinessTile
                    label={monthOverline(data.now)} value={heroAmount(data.month.summary.totals.netCents, data.month.summary.currency)}
                    sub={paceLine(data.month.summary.totals.netCents, data.month.summary.currency, data.now)}
                    width={tileWidth} onPress={onOpenMoney} testID="coach-home-v11-month"
                  />
                ) : null}
                {data.payout ? (
                  <BusinessTile
                    label="Next payout" value={heroAmount(data.payout.amountCents, data.payout.currency)} sub={cap(payoutWords(data.payout, data.now))}
                    width={tileWidth} onPress={onOpenMoney} testID="coach-home-v11-payout"
                  />
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingTop: 16, paddingBottom: 40 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  flat: { marginBottom: 0 },
  bell: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: 2, right: -8, borderWidth: 2 },
  badge: { minWidth: 20, height: 20, borderRadius: radius.chip, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.caption, fontSize: 11, lineHeight: 14, letterSpacing: 0, fontFamily: 'Inter_600SemiBold' },
  dials: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  roman: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 20, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  // Centres Roman on the first 44 pt control beside him.
  romanMark: { height: 44, justifyContent: 'center' },
  grow: { flex: 1, alignItems: 'flex-start' },
  wide: { alignSelf: 'stretch' },
  drafts: { minHeight: 44, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
  draftsLabel: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  section: { marginTop: 28 },
  rosterSection: { marginTop: 18 },
  rosterTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, marginTop: 14 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, marginTop: 10 },
  pressed: { opacity: 0.6 },
});
