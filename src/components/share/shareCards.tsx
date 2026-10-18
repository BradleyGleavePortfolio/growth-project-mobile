/**
 * The two share cards (SHARE-A, MOCK-SHARE board 3): a forest card holding the number, its words, the dates and the
 * app name. No body weight, no name, no coach name, no taglines. Each builder also gives the sheet the card's
 * screen-reader words, what is in it and what is not, and the snapshot Send to {coach} posts.
 */
import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, typography, withAlpha } from '../../theme/tokens';
import { addDays, formatDate } from '../../utils/date';
import type { ShareSnapshot } from '../../api/shareCardApi';
import type { ShareCardContent } from './ShareSheet';

const short = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** A weigh-in run of `days` days ending on `end` (YYYY-MM-DD); `shown` is the number as Progress says it ("60+"). */
export function runCard(days: number, end: string, shown: string): ShareCardContent & { snapshot: ShareSnapshot } {
  const start = addDays(end, 1 - days);
  return {
    type: 'streak',
    label: `Picture of your card: ${shown} days in a row with a weigh-in, ${short(start)} to ${short(end)}.`,
    inIt: 'In this card: your weigh-in run and its dates.',
    notInIt: 'Not in it: your weight, your name or anything else.',
    snapshot: { kind: 'weigh_in_run', value: days, words: 'days in a row', from: start, to: end },
    view: (
      <Frame eyebrow="Weigh-ins">
        <Figure value={shown} unit="days in a row" />
        <Bars days={days} />
        <View style={s.dates}>
          <Ink muted text={short(start)} style={s.small} />
          <Ink muted text={short(end)} style={s.small} />
        </View>
      </Frame>
    ),
  };
}

/** A recent best: `lift` at `weight` lb, the heaviest in the last 50 saved workouts, on `day` (YYYY-MM-DD). */
export function bestCard(lift: string, weight: number, day: string): ShareCardContent & { snapshot: ShareSnapshot } {
  const lb = weight.toLocaleString();
  return {
    type: 'pr',
    label: `Picture of your card: ${lift}, ${lb} lb, recent best, ${formatDate(day)}.`,
    inIt: 'In this card: this lift, its weight and the date.',
    notInIt: 'Not in it: your other lifts, your body weight or your name.',
    snapshot: { kind: 'recent_best', value: weight, words: lift.trim().slice(0, 60), to: day }, // SHARE-BE: words 1-60
    view: (
      <Frame eyebrow="Recent best" star>
        <Ink text={lift} style={s.lift} />
        <Figure value={lb} unit="lb" />
        <Ink text="The heaviest in your last 50 saved workouts." style={s.claim} />
        <Ink muted text={formatDate(day)} style={s.small} />
      </Frame>
    ),
  };
}

/** The forest card: eyebrow (gold with a star only for a recent best), the content, a hairline, the app name. */
export function Frame({ eyebrow, star, children }: { eyebrow: string; star?: boolean; children: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={[s.card, { backgroundColor: sc.surface.masthead }]}>
      <View style={s.eyebrowRow}>
        {star ? <Ionicons name="star" size={14} color={sc.data.peak} /> : null}
        <Text style={[s.eyebrow, { color: star ? sc.data.peak : sc.textOnMastheadMuted }]}>{eyebrow}</Text>
      </View>
      {children}
      <View style={[s.rule, { backgroundColor: withAlpha(sc.textOnMastheadMuted, 0.24) }]} />
      <Ink muted text="The Growth Project" style={s.eyebrow} />
    </View>
  );
}

export const Figure = ({ value, unit }: { value: string; unit: string }) => (
  <View style={s.figure}>
    <Ink text={value} style={s.number} />
    <Ink text={unit} style={s.unit} />
  </View>
);

/** One leaf bar per day of the run (bars only, solid, on the dark card). */
function Bars({ days }: { days: number }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={[s.bars, { gap: days > 21 ? 2 : 4 }]}>
      {Array.from({ length: days }, (_, i) => (
        <View key={i} style={[s.bar, { backgroundColor: sc.data.leaf }]} />
      ))}
    </View>
  );
}

export function Ink({ text, style, muted }: { text: string; style: TextStyle; muted?: boolean }) {
  const { semanticColors: sc } = useTheme();
  return <Text style={[style, { color: muted ? sc.textOnMastheadMuted : sc.textOnAccent }]}>{text}</Text>;
}

const s = StyleSheet.create({
  card: { borderRadius: radius.card, padding: 24, overflow: 'hidden' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { ...typography.eyebrow },
  lift: { ...typography.h2, marginTop: 12 },
  figure: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 16 },
  number: { ...typography.display, fontVariant: ['tabular-nums'] },
  unit: { ...typography.body },
  bars: { flexDirection: 'row', height: 28, marginTop: 12 },
  bar: { flex: 1, borderRadius: radius.control },
  dates: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  claim: { ...typography.body, marginTop: 8, marginBottom: 4 },
  small: { ...typography.bodySmall },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 20, marginBottom: 16 },
});
