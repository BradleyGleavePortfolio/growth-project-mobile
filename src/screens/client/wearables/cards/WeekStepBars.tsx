/**
 * WeekStepBars (HEALTH-1, MOCK-HEALTH boards 3 and 9): 7 days of steps as moss
 * bars. Today is an open bar ("So far"); a day with no reading is a dashed slot
 * ("No data"), never a zero bar. One 200 ms fade; none with Reduce Motion.
 * HEALTH-2 (boards 5 and 6): leaf on the masthead (`dark`), the starter goal as
 * a gold dashed line with its words (`goalUnit`), any metric (`title`), 30 thin
 * bars with three date marks, and `bare` for the share card (no values, no key).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import { radius, spacing, typography } from '../../../../theme/tokens';

export interface StepDay {
  readonly date: Date;
  /** null = no reading that day. */
  readonly total: number | null;
}

const LABEL = 18;

/** 8,213 -> "8.2k"; under 1,000 stays whole. */
export function shortCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

const weekday = (d: Date, form: 'short' | 'long') => d.toLocaleDateString('en-US', { weekday: form });

const monthDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
/** Month's date marks between the first day and today: the 1st of a month, if not crowding an end. */
const mids = (days: readonly StepDay[]) => days.flatMap((d, i) => (d.date.getDate() === 1 && i > 3 && i < days.length - 4 ? [i] : []));

/** MOCK-HEALTH-69: "Steps, last 7 days: {list}. Starter goal {n}." */
export function weekLabel(days: readonly StepDay[], goal: number, title = 'Steps'): string {
  const list = days.map((d, i) => `${days.length > 7 ? monthDay(d.date) : weekday(d.date, 'long')} ${d.total == null ? 'No data'
    : `${Math.round(d.total).toLocaleString('en-US')}${i === days.length - 1 ? ' so far' : ''}`}`).join(', ');
  return `${title}, last ${days.length} days: ${list}. Starter goal ${goal.toLocaleString('en-US')}.`;
}

interface Props {
  readonly days: readonly StepDay[];
  readonly goal: number;
  readonly reduceMotion: boolean;
  readonly title?: string;
  /** On the masthead (leaf bars, light words). */
  readonly dark?: boolean;
  /** Draw the starter goal as a gold dashed line, with "Starter goal: {n} {unit}". */
  readonly goalUnit?: string;
  /** The share card: no values over the bars, no key. */
  readonly bare?: boolean;
  readonly height?: number;
}

export default function WeekStepBars({ days, goal, reduceMotion, title, dark, goalUnit, bare, height = 120 }: Props) {
  const { semanticColors: sc } = useTheme();
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const run = Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [fade, reduceMotion]);

  const max = Math.max(1, ...days.map((d) => d.total ?? 0), goalUnit ? goal : 0);
  const missing = days.some((d) => d.total == null);
  const today = days.length - 1;
  const month = days.length > 7;
  const span = height - (bare || month ? 0 : LABEL);
  const [ink, muted, bar, none] = dark
    ? [sc.textOnAccent, sc.textOnMastheadMuted, sc.data.leaf, sc.data.plannedOnDark]
    : [sc.textPrimary, sc.textMuted, sc.data.moss, sc.data.planned];
  const gap = month ? 3 : spacing.sm;

  return (
    <Animated.View style={{ opacity: fade }} accessible accessibilityRole="image" accessibilityLabel={weekLabel(days, goal, title)} testID="week-step-bars">
      <View style={[styles.plot, { height, gap }]}>
        {goalUnit ? (
          <View testID="week-step-goal" style={[styles.goalLine, { bottom: (goal / max) * span }]}>
            <View style={[styles.dash, { borderColor: sc.data.goal }]} />
          </View>
        ) : null}
        {days.map((d, i) => (
          <View key={d.date.toISOString()} style={styles.slot}>
            {d.total == null ? (
              <View testID="week-step-empty" style={[styles.empty, { borderColor: none }]} />
            ) : (
              <>
                {bare || month ? null : <Text style={[styles.value, { color: ink }]} maxFontSizeMultiplier={1.3}>{shortCount(d.total)}</Text>}
                <View
                  testID={i === today ? 'week-step-today' : 'week-step-bar'}
                  style={[styles.bar, { height: Math.max(2, (d.total / max) * span), borderColor: bar },
                    i === today ? styles.open : { backgroundColor: bar }]}
                />
              </>
            )}
          </View>
        ))}
      </View>
      {month ? (
        <View style={styles.marks}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.mark, { color: muted }]}>{monthDay(days[0].date)}</Text>
          {mids(days).map((i) => (
            <Text key={i} maxFontSizeMultiplier={1.3}
              style={[styles.mark, styles.mid, { color: muted, left: `${((i + 0.5) / days.length) * 100}%` as const }]}>
              {monthDay(days[i].date)}
            </Text>
          ))}
          <Text maxFontSizeMultiplier={1.3} style={[styles.mark, styles.dayToday, { color: ink }]}>{monthDay(days[today].date)}</Text>
        </View>
      ) : (
        <View style={[styles.days, { gap }]}>
          {days.map((d, i) => (
            <Text
              key={d.date.toISOString()}
              maxFontSizeMultiplier={1.3}
              style={[styles.day, { color: i === today ? ink : muted }, i === today && styles.dayToday]}
            >
              {weekday(d.date, 'short')}
            </Text>
          ))}
        </View>
      )}
      {bare ? null : (
        <View style={styles.key}>
          {goalUnit ? (
            <View style={styles.keyItem}>
              <View style={styles.keyLine}><View style={[styles.dash, { borderColor: sc.data.goal }]} /></View>
              <Text style={[styles.keyText, { color: sc.data.goal }]}>{`Starter goal: ${goal.toLocaleString('en-US')} ${goalUnit}`}</Text>
            </View>
          ) : null}
          {days[today]?.total != null && (
            <View style={styles.keyItem}>
              <View style={[styles.swatch, styles.open, { borderColor: bar }]} />
              <Text style={[styles.keyText, { color: muted }]}>So far</Text>
            </View>
          )}
          {missing && (
            <View style={styles.keyItem}>
              <View style={[styles.swatch, styles.dashed, { borderColor: none }]} />
              <Text style={[styles.keyText, { color: muted }]}>No data</Text>
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: 'row', alignItems: 'flex-end' },
  goalLine: { position: 'absolute', left: 0, right: 0, height: 1, overflow: 'hidden' },
  dash: { height: 3, borderWidth: 1, borderStyle: 'dashed' }, // clipped to its top edge: one dashed line on iOS and Android
  keyLine: { width: 16, height: 1, overflow: 'hidden' },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  value: { ...typography.caption, textTransform: 'none', letterSpacing: 0, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  bar: { width: '100%', borderWidth: 2, borderTopLeftRadius: radius.control, borderTopRightRadius: radius.control },
  open: { backgroundColor: 'transparent', borderWidth: 2 },
  empty: { width: '100%', height: 10, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.control },
  dashed: { borderWidth: 1, borderStyle: 'dashed' },
  days: { flexDirection: 'row', marginTop: spacing.sm },
  day: { ...typography.bodySmall, flex: 1, textAlign: 'center' },
  marks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  mark: { ...typography.bodySmall },
  mid: { position: 'absolute', top: 0, width: 72, marginLeft: -36, textAlign: 'center' }, // centred on its bar
  dayToday: { fontFamily: 'Inter_600SemiBold' },
  key: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 12, height: 12, borderRadius: radius.control },
  keyText: { ...typography.bodySmall },
});
