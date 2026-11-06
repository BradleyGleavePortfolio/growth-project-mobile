/**
 * NEEDS-YOU-M (agent 197): the Needs you list, variant B of planning/MOCKUP3/NEEDS-YOU-R2 (owner #197-E5, D3 B), on the
 * Clients lookup's view 'needs' (the Home's Needs you card opens it). A deep masthead with Back, "Needs you, {n}",
 * search and a switch of two areas: Attention (Safety pinned first in safety gold, #197-E3; Alerts; Gone quiet; New
 * this week) and Routine (check-ins to review and messages to answer). It opens on Attention whenever Attention has an
 * item (ND-10). Workout-change approvals are not here: they are tiles in Roman's drafts on the Home (#197-E5).
 * The grouping is the Home card's (utils/coach/needsYou), so the card's numbers are the list's.
 */
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { ActionQueueItem } from '../../../services/commandCenterApi';
import { safetyGold } from '../../../theme/safetyGold';
import { colors as palette, forestPop, layout, radius, typography } from '../../../theme/tokens';
import { useScreenInsets } from '../../../ui';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { initialsOf, type LookupAction } from '../../../utils/coach/clientLookup';
import { joinedLine, matchesRosterSearch, rosterDisplayName, type RosterClient } from '../../../utils/coach/clientRoster';
import { alertWhen, sentAgo, type NeedsAreas, type NeedsClientRow } from '../../../utils/coach/needsYou';
import { safetyCardLine } from '../client-detail/SafetyAlertCard';
import { EYEBROW, SEMI, styleA } from '../home-v11/HomeParts';

const ACTION_LABEL: Record<LookupAction, string> = { review: 'Review', reply: 'Reply', nudge: 'Nudge', hello: 'Say hello' };
type Side = 'attention' | 'routine';

export interface NeedsYouListProps {
  areas: NeedsAreas;
  /** The active roster's size, for the subtitle. */
  rosterCount: number;
  /** The roster or the alerts are still on their way (verified alerts still show above it, LS-934 B2). */
  loading: boolean;
  /** The roster did not load and no verified client is on screen (verified alerts still show above it). */
  error: string | null;
  /** The alerts read failed: the list says so under the switch. */
  alertsFailed: boolean;
  refreshing: boolean;
  now?: Date;
  onBack: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onOpenSafety: (item: ActionQueueItem) => void;
  onOpenAlert: (item: ActionQueueItem) => void;
  onOpenClient: (c: RosterClient) => void;
  onAction: (c: RosterClient, a: LookupAction) => void;
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const initialsOfName = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');

export default function NeedsYouList(p: NeedsYouListProps) {
  const { top, bottom } = useScreenInsets();
  const [chosen, setChosen] = useState<Side | null>(null);
  const [query, setQuery] = useState('');
  const a = p.areas;
  const side: Side = chosen ?? (a.attention > 0 || a.routineCount === 0 ? 'attention' : 'routine');
  const q = query.trim().toLowerCase();
  const alertHit = (i: ActionQueueItem) => !q || i.client_name.toLowerCase().includes(q);
  const rowHit = (r: NeedsClientRow) => !q || matchesRosterSearch(r.client, q);
  const now = p.now ?? new Date();
  const safetyOpen = a.safety.length > 0;
  const held = p.loading || !!p.error || p.alertsFailed; // no complete total until every counted read answers

  const avatar = (text: string, gold = false) => (
    <View style={[s.avatar, gold && s.avatarGold]}><Text style={s.avatarText} maxFontSizeMultiplier={1.3}>{text}</Text></View>
  );
  const dotLine = (text: string, tone: 'quiet' | 'alert' | 'routine' | 'new' | 'safety', lines = 3) => (
    <View style={s.dotRow}>
      <View style={[s.dot, { backgroundColor: DOT[tone] }]} />
      <Text style={s.line} numberOfLines={lines}>{text}</Text>
    </View>
  );
  const header = (label: string, n: number, opts: { safety?: boolean } = {}) => (
    <View style={s.sect} accessibilityRole="header" accessibilityLabel={`${label}, ${n}${opts.safety ? ', pinned first' : ''}`}>
      {opts.safety ? <Ionicons name="shield-outline" size={14} color={safetyGold.text} /> : null}
      <Text style={[s.sectText, opts.safety && { color: safetyGold.text }]}>{label.toUpperCase()}</Text>
      <View style={s.grow} />
      {opts.safety ? <Text style={s.pinned}>Pinned first</Text> : null}
      <View style={[s.pill, opts.safety && s.pillGold]}><Text style={[s.pillText, opts.safety && s.pillTextGold]}>{n}</Text></View>
    </View>
  );

  const safetyRow = (i: ActionQueueItem, k: number) => {
    const line = safetyCardLine(i.alert_type, first(i.client_name)) ?? i.message;
    const when = sentAgo(i.sent_at ?? i.created_at, now);
    return (
      // The client's words never show here (#ROMAN-CRISIS-ALERT): only the approved line with the first name.
      <HapticPressable
        key={i.alert_id} intent="light" style={[s.row, k > 0 && s.rowLine]} onPress={() => p.onOpenSafety(i)}
        accessibilityRole="button" accessibilityLabel={`Safety alert. ${i.client_name}. ${when}. ${line}`} testID={`needs-safety-${i.alert_id}`}
      >
        {avatar(initialsOfName(i.client_name), true)}
        <View style={s.mid}>
          <Text style={s.name} numberOfLines={2}>{i.client_name}</Text>
          {when ? <Text style={s.when}>{when}</Text> : null}
          {dotLine(line, 'safety', 0)}
        </View>
        <Ionicons name="chevron-forward" size={20} color={styleA.inkMuted} />
      </HapticPressable>
    );
  };
  const alertRow = (i: ActionQueueItem, k: number) => {
    const when = alertWhen(i.created_at, now);
    return (
      <HapticPressable
        key={i.alert_id} intent="light" style={[s.row, k > 0 && s.rowLine]} onPress={() => p.onOpenAlert(i)}
        accessibilityRole="button" accessibilityLabel={`${i.client_name}. ${when}. ${i.message}`} testID={`needs-alert-${i.alert_id}`}
      >
        {avatar(initialsOfName(i.client_name))}
        <View style={s.mid}>
          <Text style={s.name} numberOfLines={2}>{i.client_name}</Text>
          {when ? <Text style={s.when}>{when}</Text> : null}
          {dotLine(i.message, 'alert', 0)}
        </View>
        <Ionicons name="chevron-forward" size={20} color={styleA.inkMuted} />
      </HapticPressable>
    );
  };
  const clientRow = (r: NeedsClientRow, k: number, tone: 'quiet' | 'new' | 'routine') => {
    const name = rosterDisplayName(r.client);
    const act = r.reason.action;
    const joined = tone === 'routine' ? null : joinedLine(r.client); // GOAL N1: Gone quiet and New this week (NY-16, LO-934 B3)
    return (
      <View key={r.client.id} style={[s.row, k > 0 && s.rowLine]}>
        {/* HapticPressable's own wrapper takes no flex, so each side gets a View; under 170 pt the action wraps below. */}
        <View style={[s.grow, s.rowMainWrap]}>
          <HapticPressable
            intent="light" style={s.rowMain} onPress={() => p.onOpenClient(r.client)} accessibilityRole="button"
            accessibilityLabel={[name, r.reason.text, r.also].filter(Boolean).join(', ')} testID={`needs-row-${r.client.id}`}
          >
            {avatar(initialsOf(r.client))}
            <View style={s.mid}>
              <Text style={s.name} numberOfLines={2}>{name}</Text>
              {joined ? <Text style={s.when}>{joined}</Text> : null}
              {dotLine(r.reason.text, tone)}
              {r.also ? <View style={s.tag}><Text style={s.tagText}>{r.also}</Text></View> : null}
            </View>
          </HapticPressable>
        </View>
        {act ? (
          <View style={s.actWrap}>
            <HapticPressable
              intent="light" style={s.act} onPress={() => p.onAction(r.client, act)} accessibilityRole="button"
              accessibilityLabel={`${ACTION_LABEL[act]}, ${name}`} testID={`needs-act-${r.client.id}`}
            >
              <Text style={s.actText} maxFontSizeMultiplier={1.3}>{ACTION_LABEL[act]}</Text>
            </HapticPressable>
          </View>
        ) : null}
      </View>
    );
  };
  const group = <T,>(label: string, rows: T[], draw: (x: T, k: number) => React.ReactNode, opts: { safety?: boolean } = {}) =>
    rows.length === 0 ? null : (
      <View key={label} testID={`needs-group-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        {header(label, rows.length, opts)}
        <View style={[s.card, opts.safety && s.cardGold]} testID={`needs-card-${label.toLowerCase().replace(/\s+/g, '-')}`}>{rows.map(draw)}</View>
      </View>
    );

  let body: React.ReactNode;
  if (held) {
    // LS-934 B2: verified alerts never wait on the roster; the clients' loading or Try again sits under them.
    body = (
      <>
        {group('Safety', a.safety, safetyRow, { safety: true })}
        {group('Alerts', a.alerts, alertRow)}
        {p.loading ? <QuietLoading label="Loading who needs you" rows={5} testID="needs-loading" />
          : <QuietError message={p.error ?? 'Alerts did not load. Pull down to try again.'} onRetry={p.onRetry} testID={p.error ? 'needs-error' : 'needs-alerts-error'} />}
      </>
    );
  } else if (a.total === 0) {
    body = (
      <View style={s.card} testID="needs-empty">
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>Nobody needs you right now.</Text>
          <Text style={s.emptyBody}>Safety alerts, other alerts and clients who need you show here, most urgent first.</Text>
        </View>
      </View>
    );
  } else if (side === 'attention') {
    const safety = a.safety.filter(alertHit);
    const alerts = a.alerts.filter(alertHit);
    const quiet = a.quiet.filter(rowHit);
    const fresh = a.fresh.filter(rowHit);
    body = a.attention === 0 ? <Text style={s.half} testID="needs-attention-empty">Nothing needs attention right now.</Text> : (
      <>
        {group('Safety', safety, safetyRow, { safety: true })}
        {group('Alerts', alerts, alertRow)}
        {group('Gone quiet', quiet, (r, k) => clientRow(r, k, 'quiet'))}
        {group('New this week', fresh, (r, k) => clientRow(r, k, 'new'))}
      </>
    );
  } else {
    const rows = a.routine.filter(rowHit);
    body = a.routineCount === 0 ? <Text style={s.half} testID="needs-routine-empty">No replies or check-ins waiting.</Text> : (
      rows.length > 0 ? <View style={[s.card, s.first]} testID="needs-group-routine">{rows.map((r, k) => clientRow(r, k, 'routine'))}</View> : null
    );
  }

  const half = (key: Side, label: string, n: number) => {
    const on = side === key;
    return (
      <View key={key} style={s.grow}>
        <HapticPressable
          intent="light" style={[s.half2, on && s.halfOn]} onPress={() => setChosen(key)} accessibilityRole="tab"
          accessibilityState={{ selected: on }} accessibilityLabel={`${label}, ${n} ${n === 1 ? 'item' : 'items'}${key === 'attention' && safetyOpen ? ', safety alert open' : ''}`}
          testID={`needs-switch-${key}`}
        >
          {key === 'attention' && safetyOpen ? <Ionicons name="shield-outline" size={16} color={on ? safetyGold.text : forestPop.gold} /> : null}
          <Text style={[s.halfText, on && s.halfTextOn]} numberOfLines={2} maxFontSizeMultiplier={1.3}>{`${label} ${n}`}</Text>
        </HapticPressable>
      </View>
    );
  };

  return (
    <ScrollView
      style={s.screen} contentContainerStyle={{ paddingBottom: 32 + bottom }} keyboardShouldPersistTaps="handled" testID="needs-list"
      refreshControl={<RefreshControl refreshing={p.refreshing} onRefresh={p.onRefresh} tintColor={palette.forest} />}
    >
      <View style={[s.mast, { paddingTop: top + 4 }]}>
        <View style={s.topRow}>
          <HapticPressable intent="light" style={s.back} onPress={p.onBack} accessibilityRole="button" accessibilityLabel="Back" testID="needs-back">
            <Ionicons name="chevron-back" size={26} color={styleA.onDeep} />
          </HapticPressable>
          <View style={s.grow} />
          {a.total > 0 ? <Text style={s.eyebrow} maxFontSizeMultiplier={1.3}>MOST URGENT FIRST</Text> : null}
        </View>
        {/* No count, roster size, search or switch until every counted read is verified. */}
        <Text style={s.title} accessibilityRole="header" testID="needs-title">{held ? 'Needs you' : `Needs you, ${a.total}`}</Text>
        {held ? null : <Text style={s.sub}>{`Alerts and clients from your ${p.rosterCount}, grouped by what they need`}</Text>}
        {a.total > 0 && !held ? (
          <>
            <View style={s.search}>
              <Ionicons name="search" size={20} color={forestPop.onDeepMuted} />
              <TextInput
                style={s.searchInput} value={query} onChangeText={setQuery} placeholder={`Search ${a.total}`} placeholderTextColor={forestPop.onDeepMuted}
                accessibilityLabel={`Search ${a.total}`} autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing" testID="needs-search"
              />
            </View>
            <View style={s.switch} accessibilityRole="tablist">
              {half('attention', 'Attention', a.attention)}
              {half('routine', 'Routine', a.routineCount)}
            </View>
          </>
        ) : null}
      </View>
      <View style={s.page}>
        {p.alertsFailed && (p.loading || p.error) ? <Text style={s.note} testID="needs-alerts-error">Alerts did not load. Pull down to try again.</Text> : null}
        {body}
      </View>
    </ScrollView>
  );
}

const DOT = { safety: safetyGold.edge, alert: forestPop.deep, quiet: '#8A2A1F', routine: '#5B8A3C', new: '#7E8F84' } as const;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bone },
  mast: { backgroundColor: forestPop.deep, paddingHorizontal: layout.gutter, paddingBottom: 16, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  back: { minWidth: 44, minHeight: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...EYEBROW, color: forestPop.onDeepMuted },
  // LS-934 B4: GOAL NEEDS-YOU-R2 gen.py `.h1` 32/38, `.lr` padding 10 x 14, `.av` 40 (14), `.nm` 15.5/20.
  title: { fontFamily: 'CormorantGaramond_400Regular', fontSize: 32, lineHeight: 38, color: styleA.onDeep, marginTop: 4 },
  sub: { ...typography.bodySmall, color: forestPop.onDeepMuted, marginTop: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginTop: 14, paddingHorizontal: 14, borderRadius: radius.input, backgroundColor: styleA.deep2 },
  searchInput: { ...typography.body, flex: 1, minWidth: 0, color: styleA.onDeep, paddingVertical: 8 },
  switch: { flexDirection: 'row', marginTop: 10, padding: 4, gap: 4, borderRadius: radius.button + 4, backgroundColor: styleA.deep2 },
  half2: { flex: 1, minHeight: 48, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, paddingHorizontal: 8 },
  halfOn: { backgroundColor: forestPop.leaf },
  halfText: { ...typography.bodyMd, fontFamily: SEMI, fontSize: 16, color: styleA.onDeep, flexShrink: 1, textAlign: 'center' },
  halfTextOn: { color: forestPop.deep },
  page: { paddingHorizontal: layout.gutter, paddingTop: 6 },
  note: { ...typography.bodySmall, color: styleA.grey, marginTop: 12 },
  sect: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, marginBottom: 8 },
  sectText: { ...EYEBROW, color: styleA.ink },
  pinned: { ...typography.bodySmall, fontSize: 13, color: styleA.grey, marginRight: 4 },
  pill: { minWidth: 24, height: 24, borderRadius: radius.chip, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: forestPop.deep },
  pillGold: { backgroundColor: safetyGold.chipFill },
  pillText: { fontFamily: SEMI, fontSize: 13, lineHeight: 16, color: forestPop.leaf },
  pillTextGold: { color: safetyGold.chipText },
  card: { backgroundColor: styleA.card, borderRadius: radius.card, borderWidth: 1, borderColor: styleA.cardLine, overflow: 'hidden' },
  cardGold: { borderWidth: 2, borderColor: safetyGold.edge, backgroundColor: safetyGold.card },
  first: { marginTop: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, rowGap: 8, minHeight: 72, paddingVertical: 10, paddingHorizontal: 14 },
  rowLine: { borderTopWidth: 1, borderTopColor: styleA.cardLine },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  mid: { flex: 1, minWidth: 0 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: forestPop.deep, alignItems: 'center', justifyContent: 'center' },
  avatarGold: { borderWidth: 2, borderColor: safetyGold.edge },
  avatarText: { fontFamily: SEMI, fontSize: 14, color: forestPop.leaf },
  name: { ...typography.bodyMd, fontFamily: SEMI, fontSize: 15.5, lineHeight: 20, color: styleA.ink },
  when: { ...typography.bodySmall, color: styleA.grey },
  dotRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  line: { ...typography.bodySmall, color: styleA.ink, flexShrink: 1 },
  tag: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.chip, borderWidth: 1, borderColor: styleA.cardLine, backgroundColor: '#EEF1EC' },
  tagText: { ...typography.caption, fontFamily: SEMI, fontSize: 12, lineHeight: 16, letterSpacing: 0, color: styleA.grey },
  act: { minHeight: 48, minWidth: 84, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button, borderWidth: 1.5, borderColor: forestPop.deep },
  actText: { ...typography.bodyMd, fontFamily: SEMI, fontSize: 15, color: forestPop.deep },
  half: { ...typography.body, color: styleA.grey, marginTop: 20 },
  emptyBox: { padding: 20 },
  emptyTitle: { ...typography.bodyMd, fontFamily: SEMI, fontSize: 17, color: styleA.ink },
  emptyBody: { ...typography.bodySmall, color: styleA.grey, marginTop: 4 },
  grow: { flex: 1 },
  rowMainWrap: { minWidth: 170 },
  actWrap: { marginLeft: 'auto' },
});
