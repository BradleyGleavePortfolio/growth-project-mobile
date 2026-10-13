/**
 * UI-2 coach Home (V1_1_UI_SPEC UI-2, owner 10-09 "render 2"), behind featureFlags.coachHomeV11: the date and
 * bell, three dials, Roman with the one action "Approve Roman's drafts →", the clients who need the coach as
 * tiles, and Business. Only real numbers are drawn; a dial with no real base is left out. Zero clients: the
 * Clients and Earnings dials, then the existing setup cards (`header`).
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { QuietOverline, TextLink } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { HapticService } from '../../../ui/haptics/haptics.service';
import type { CoachHomeSources } from '../command-center/coachHomeSources';
import { dateOverline, heroAmount, lastActiveWords, monthOverline, paceLine, payoutWords, retentionPct } from '../command-center/coachHomeCopy';
import { hasMonthMoney } from '../command-center/CoachHomeSections';
import { AllClientsTile, BusinessTile, ClientTile, HomeDial, type DialSpec } from './HomeParts';
import { useCoachHomeV11, type CoachHomeData } from './useCoachHomeV11';

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

export default function CoachHomeV11({ onSelectClient, onOpenClients, onOpenMoney, onOpenDrafts, onOpenNotifications, onAskRoman, header, sources }: Props) {
  const { semanticColors: sc } = useTheme();
  const { width } = useWindowDimensions();
  const { data, reload, retryMonth } = useCoachHomeV11(sources);
  const tileWidth = (Math.min(width, 600) - 2 * layout.gutter - TILE_GAP) / 2;
  const o = data.overview;
  const roster = o?.roster_size ?? 0;
  const dials = homeDials(data);
  const urgent = roster > 0 && (o?.at_risk_count ?? 0) > 0 ? data.urgent.slice(0, MAX_TILES) : [];
  const bell = data.unreadNotifications;

  return (
    <ScrollView
      style={{ backgroundColor: sc.bgPrimary }} contentContainerStyle={styles.content} testID="coach-home-v11"
      refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => void reload(true)} tintColor={sc.accent} />}
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

      {data.draftsWaiting > 0 || onAskRoman ? (
        <View style={[styles.roman, { borderColor: sc.border }]} testID="coach-home-v11-roman">
          <View style={styles.romanMark}><RomanAvatar crop="monogram" size={28} /></View>
          <View style={styles.grow}>
            {data.draftsWaiting > 0 ? (
              <Pressable
                onPress={() => { void HapticService.mediumImpact(); onOpenDrafts(); }}
                accessibilityRole="button" accessibilityLabel={`Approve Roman's drafts, ${data.draftsWaiting}`} testID="coach-home-v11-drafts"
                style={({ pressed }) => [styles.drafts, { backgroundColor: sc.accent }, pressed && styles.pressed]}
              >
                <Text style={[styles.draftsLabel, { color: sc.textOnAccent }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>Approve Roman's drafts →</Text>
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
        <View style={styles.section}>
          {urgent.length > 0 ? <QuietOverline accessibilityRole="header">{`Needs you, ${o.at_risk_count}`}</QuietOverline> : null}
          <View style={styles.tiles}>
            {urgent.map((e) => (
              <ClientTile
                key={e.user_id} name={e.display_name} line={lastActiveWords(e.last_active_at, data.now)} reason={e.top_factor}
                width={tileWidth} onPress={() => onSelectClient(e.user_id, e.display_name)} testID={`coach-home-v11-client-${e.user_id}`}
              />
            ))}
            <AllClientsTile count={roster} width={tileWidth} onPress={onOpenClients} />
          </View>
        </View>
      ) : null}

      {o && roster > 0 && (data.month.kind !== 'loading' || data.payout) ? (
        <View style={styles.section} testID="coach-home-v11-business">
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
  drafts: { minHeight: 44, borderRadius: radius.button, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
  draftsLabel: { ...typography.bodyMd, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  section: { marginTop: 28 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, marginTop: 10 },
  pressed: { opacity: 0.6 },
});
