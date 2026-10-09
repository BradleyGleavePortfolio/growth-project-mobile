/**
 * COACH-HOME-134: the coach Home pieces, to the luxury target coach-home-solo ("the bar, not the blueprint"). No client
 * photo upload exists, so every face is a MonogramBadge. Theme colours and radius tokens only; serif lineHeight >= 1.25 x.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { QuietOverline, TextLink } from '../../../ui';
import MonogramBadge from '../../../components/community/coach/MonogramBadge';
import LoadFailedNotice from '../../../components/coach/LoadFailedNotice';
import type { MoneySummary } from '../../../api/coachMoneyApi';
import type { AtRiskEntry } from '../../../services/commandCenterApi';
import { changeVsLastMonth, heroAmount, lastActiveWords, monthOverline, overlinePair, paceLine } from './coachHomeCopy';

export type EarningsState = { kind: 'loading' | 'blocked' | 'error' } | { kind: 'ok'; summary: MoneySummary };
// B-633-SOL-D-134-1: head-coach split income and refunds of earlier sales move net with no own charge.
export const hasMonthMoney = (s: MoneySummary) => s.totals.chargeCount > 0 || s.totals.netCents !== 0;
export interface StatCell { key: string; label: string; value: string; sub?: string; testID: string; subTestID?: string }

export function HomeOverline({ firstName, now }: { firstName?: string | null; now: Date }) {
  const { semanticColors: sc } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const [date, greeting] = overlinePair(now, firstName, width - 2 * layout.gutter, Math.min(fontScale || 1, 1.3));
  return (
    <View style={[styles.overlineRow, { borderBottomColor: sc.border }]} testID="coach-home-overline">
      <QuietOverline style={styles.flat} maxFontSizeMultiplier={1.3}>{date}</QuietOverline>
      <QuietOverline style={styles.flat} maxFontSizeMultiplier={1.3}>{greeting}</QuietOverline>
    </View>
  );
}

export function CalmLine({ title, detail, testID }: { title: string; detail?: string; testID: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View testID={testID}>
      <Text style={[styles.calm, { color: sc.textPrimary }]}>{title}</Text>
      {detail ? <Text style={[styles.calmDetail, { color: sc.textMuted }]}>{detail}</Text> : null}
    </View>
  );
}

/** The month so far, only when there is a real figure; otherwise one calm line. */
export function EarningsHero({ state, now, onRetry }: { state: EarningsState; now: Date; onRetry: () => void }) {
  const { semanticColors: sc } = useTheme();
  let body: React.ReactNode = <View style={styles.heroPlaceholder} testID="coach-home-hero-loading" />;
  if (state.kind === 'ok' && hasMonthMoney(state.summary)) {
    const { totals, changeCents, currency } = state.summary;
    const amount = heroAmount(totals.netCents, currency);
    const change = changeVsLastMonth(changeCents, currency, now);
    body = (
      <>
        <Text
          style={[styles.heroNumber, { color: sc.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}
          accessibilityLabel={`Net to you, ${monthOverline(now)}: ${amount}`} testID="coach-home-hero-amount"
        >
          {amount}
        </Text>
        {change ? <Text style={[styles.change, { color: (changeCents ?? 0) > 0 ? sc.accentText : sc.textMuted }]}>{change}</Text> : null}
        <Text style={[styles.small, { color: sc.textMuted }]}>{paceLine(totals.netCents, currency, now)}</Text>
      </>
    );
  } else if (state.kind === 'ok') {
    body = <CalmLine title="No earnings yet this month." detail="Client payments land here as they come in." testID="coach-home-hero-empty" />;
  } else if (state.kind === 'blocked') {
    body = <CalmLine title="Payments run through your head coach's practice." testID="coach-home-hero-head-coach" />;
  } else if (state.kind === 'error') {
    body = <LoadFailedNotice message="This month's earnings could not load." onRetry={onRetry} testID="coach-home-hero-error" />;
  }
  return (
    <View style={styles.hero} testID="coach-home-hero">
      <QuietOverline accessibilityRole="header">{monthOverline(now)}</QuietOverline>
      {body}
    </View>
  );
}

/** Three-up hairline row: small-caps label, serif number, muted line. */
export function StatRow({ cells }: { cells: StatCell[] }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={[styles.statRow, { borderColor: sc.border }]} testID="coach-home-stats">
      {cells.map((c, i) => (
        <View
          key={c.key} testID={c.testID} accessible accessibilityLabel={`${c.label}: ${c.value}${c.sub ? `. ${c.sub}` : ''}`}
          style={[styles.statCell, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: sc.border }]}
        >
          <QuietOverline style={styles.center} numberOfLines={1}>{c.label}</QuietOverline>
          <Text style={[styles.statValue, { color: sc.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
            {c.value}
          </Text>
          {c.sub ? <Text style={[styles.small, styles.center, { color: sc.textMuted }]} numberOfLines={1} testID={c.subTestID}>{c.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** The most urgent client (name as the headline, "Send a message"), or a quiet row for the next ones. */
export function ClientCard({ entry, now, urgent, onOpen, onMessage }: {
  entry: AtRiskEntry; now: Date; urgent?: boolean; onOpen: () => void; onMessage?: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const name = entry.display_name;
  const when = lastActiveWords(entry.last_active_at, now);
  return (
    <Pressable
      onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${urgent ? 'Most urgent: ' : ''}${name}. ${entry.top_factor}. Open their file.`}
      testID={urgent ? 'coach-home-urgent' : `coach-home-client-${entry.user_id}`}
      // The card is one accessible element, so "Send a message" is offered to VoiceOver / TalkBack as an action on it.
      accessibilityActions={urgent && onMessage ? [{ name: 'message', label: 'Send a message' }] : undefined}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'message' && onMessage?.()}
      style={({ pressed }) => [
        urgent ? [styles.urgent, { backgroundColor: sc.bgSurface, borderColor: sc.border }] : [styles.row, { borderBottomColor: sc.border }],
        pressed && styles.pressed,
      ]}
    >
      {urgent ? null : <MonogramBadge name={name} size={36} />}
      <View style={styles.grow}>
        {urgent ? <QuietOverline>Most urgent</QuietOverline> : null}
        <Text style={[urgent ? styles.urgentName : styles.rowName, { color: sc.textPrimary }]} numberOfLines={urgent ? 2 : 1}>{name}</Text>
        <Text style={[styles.factor, { color: sc.textMuted }]} numberOfLines={2}>
          {entry.top_factor}{when ? <Text style={styles.when}>{`  ·  ${when}`}</Text> : null}
        </Text>
        {urgent && onMessage ? <TextLink label="Send a message" onPress={onMessage} tone="accent" align="start" testID="coach-home-urgent-message" /> : null}
      </View>
      {urgent ? <MonogramBadge name={name} size={56} /> : <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />}
    </Pressable>
  );
}

/** A count that opens its tab: Inter label, the need in words, serif ink number. */
export function CountRow({ label, value, words, onPress, accessibilityLabel, testID }: {
  label: string; value: string; words?: string; onPress?: () => void; accessibilityLabel: string; testID: string;
}) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : 'text'} accessibilityLabel={accessibilityLabel} testID={testID}
      style={({ pressed }) => [styles.row, { borderBottomColor: sc.border }, pressed && styles.pressed]}
    >
      <View style={styles.grow}>
        <Text style={[typography.body, { color: sc.textPrimary }]}>{label}</Text>
        {words ? <Text style={[styles.small, { color: sc.textMuted }]}>{words}</Text> : null}
      </View>
      <Text style={[styles.rowValue, { color: sc.textPrimary }]}>{value}</Text>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={sc.textMuted} /> : null}
    </Pressable>
  );
}

// Cormorant's default figures are old-style (a serif "1" reads like "I"); its lnum + tnum give lining, even figures.
export const FIGURES: TextStyle['fontVariant'] = ['lining-nums', 'tabular-nums'];

const styles = StyleSheet.create({
  overlineRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 28 },
  flat: { marginBottom: 0 },
  hero: { marginBottom: 28 },
  // Cormorant at 64 / 80 (1.25 x, B15): the one hero number on the screen.
  heroNumber: { ...typography.display, fontSize: 64, lineHeight: 80, letterSpacing: 0, fontVariant: FIGURES },
  heroPlaceholder: { height: 80 },
  change: { ...typography.bodyMd, marginTop: 2 },
  small: { ...typography.bodySmall },
  calm: { ...typography.h2, marginTop: 4 },
  calmDetail: { ...typography.body, marginTop: 6 },
  statRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 20 },
  statCell: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  center: { textAlign: 'center' },
  statValue: { ...typography.h1, fontVariant: FIGURES, marginTop: 4 },
  urgent: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6, marginBottom: 4 },
  urgentName: { ...typography.h1, marginTop: 2 },
  factor: { fontFamily: typography.display.fontFamily, fontStyle: 'italic', fontSize: 17, lineHeight: 22 },
  when: { ...typography.bodySmall, fontStyle: 'normal' },
  row: { minHeight: layout.rowMinHeight, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  rowName: { ...typography.bodyMd },
  rowValue: { ...typography.h2, fontVariant: FIGURES },
  pressed: { opacity: 0.6 },
});
