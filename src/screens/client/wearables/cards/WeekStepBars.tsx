/**
 * WeekStepBars (HEALTH-1, MOCK-HEALTH boards 3 and 9): 7 days of steps as moss
 * bars. Today is an open bar ("So far"); a day with no reading is a dashed slot
 * ("No data"), never a zero bar. One 200 ms fade; none with Reduce Motion.
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

const BAR_AREA = 120;
const LABEL = 18;

/** 8,213 -> "8.2k"; under 1,000 stays whole. */
export function shortCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}

const weekday = (d: Date, form: 'short' | 'long') => d.toLocaleDateString('en-US', { weekday: form });

/** MOCK-HEALTH-69: "Steps, last 7 days: {list}. Starter goal {n}." */
export function weekLabel(days: readonly StepDay[], goal: number): string {
  const list = days.map((d, i) => `${weekday(d.date, 'long')} ${d.total == null ? 'No data'
    : `${Math.round(d.total).toLocaleString('en-US')}${i === days.length - 1 ? ' so far' : ''}`}`).join(', ');
  return `Steps, last 7 days: ${list}. Starter goal ${goal.toLocaleString('en-US')}.`;
}

interface Props {
  readonly days: readonly StepDay[];
  readonly goal: number;
  readonly reduceMotion: boolean;
}

export default function WeekStepBars({ days, goal, reduceMotion }: Props) {
  const { semanticColors: sc } = useTheme();
  const fade = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const run = Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [fade, reduceMotion]);

  const max = Math.max(1, ...days.map((d) => d.total ?? 0));
  const missing = days.some((d) => d.total == null);
  const today = days.length - 1;

  return (
    <Animated.View style={{ opacity: fade }} accessible accessibilityRole="image" accessibilityLabel={weekLabel(days, goal)} testID="week-step-bars">
      <View style={styles.plot}>
        {days.map((d, i) => (
          <View key={d.date.toISOString()} style={styles.slot}>
            {d.total == null ? (
              <View testID="week-step-empty" style={[styles.empty, { borderColor: sc.data.planned }]} />
            ) : (
              <>
                <Text style={[styles.value, { color: sc.textPrimary }]} maxFontSizeMultiplier={1.3}>{shortCount(d.total)}</Text>
                <View
                  testID={i === today ? 'week-step-today' : 'week-step-bar'}
                  style={[styles.bar, { height: Math.max(2, (d.total / max) * (BAR_AREA - LABEL)), borderColor: sc.data.moss },
                    i === today ? styles.open : { backgroundColor: sc.data.moss }]}
                />
              </>
            )}
          </View>
        ))}
      </View>
      <View style={styles.days}>
        {days.map((d, i) => (
          <Text
            key={d.date.toISOString()}
            maxFontSizeMultiplier={1.3}
            style={[styles.day, { color: i === today ? sc.textPrimary : sc.textMuted }, i === today && styles.dayToday]}
          >
            {weekday(d.date, 'short')}
          </Text>
        ))}
      </View>
      <View style={styles.key}>
        {days[today]?.total != null && (
          <View style={styles.keyItem}>
            <View style={[styles.swatch, styles.open, { borderColor: sc.data.moss }]} />
            <Text style={[styles.keyText, { color: sc.textMuted }]}>So far</Text>
          </View>
        )}
        {missing && (
          <View style={styles.keyItem}>
            <View style={[styles.swatch, styles.dashed, { borderColor: sc.data.planned }]} />
            <Text style={[styles.keyText, { color: sc.textMuted }]}>No data</Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: 'row', alignItems: 'flex-end', height: BAR_AREA, gap: spacing.sm },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  value: { ...typography.caption, textTransform: 'none', letterSpacing: 0, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  bar: { width: '100%', borderWidth: 2, borderTopLeftRadius: radius.control, borderTopRightRadius: radius.control },
  open: { backgroundColor: 'transparent', borderWidth: 2 },
  empty: { width: '100%', height: 10, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.control },
  dashed: { borderWidth: 1, borderStyle: 'dashed' },
  days: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  day: { ...typography.bodySmall, flex: 1, textAlign: 'center' },
  dayToday: { fontFamily: 'Inter_600SemiBold' },
  key: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 12, height: 12, borderRadius: radius.control },
  keyText: { ...typography.bodySmall },
});
