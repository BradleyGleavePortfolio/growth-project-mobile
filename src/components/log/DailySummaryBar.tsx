import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors, Spacing } from '../../theme/index';
import { useTheme } from '../../theme/useTheme';
import QuietBar, { QuietText as Text } from '../../ui/progress/QuietBar';
import type { MacroDisplayMode } from '../../macros/macroDisplay';

interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Props {
  dailyTotals: DailyTotals;
  remaining: number | null;
  targets?: DailyTotals | null;
  /**
   * 'simple' during a never-tracker's first week (clinic contract v1
   * addition 8): calories and protein only. Defaults to 'full'.
   */
  mode?: MacroDisplayMode;
}

export default function DailySummaryBar({
  dailyTotals,
  remaining,
  targets,
  mode = 'full',
}: Props) {
  const simple = mode === 'simple';
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  return (
    <View
      style={styles.summaryBar}
      testID={simple ? 'daily-summary-simple' : 'daily-summary-full'}
    >
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>
          {Math.round(remaining == null ? dailyTotals.calories : Math.abs(remaining))}
        </Text>
        <Text style={styles.summaryLabel}>{remaining == null ? 'Calories eaten · No target' : remaining < 0 ? 'Calories over target' : 'Calories left'}</Text>
        {remaining != null || targets ? <Text style={styles.summaryLabel}>
          {targets ? `of ${targets.calories} · ` : ''}{Math.round(dailyTotals.calories)} eaten
        </Text> : null}
      </View>
      {(simple ? ['protein'] as const : ['protein', 'carbs', 'fat'] as const).map((key) => {
        const eaten = Math.round(dailyTotals[key]);
        const target = targets?.[key];
        const over = target != null && eaten > target ? ` · ${Math.round(eaten - target)} g over` : '';
        return <QuietBar key={key} label={key[0].toUpperCase() + key.slice(1)} current={dailyTotals[key]} target={target}
          value={`${eaten}g${target != null ? ` / ${target}g goal` : ''}${over}`} />;
      })}
    </View>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  summaryBar: {
    gap: 16,
    marginHorizontal: Spacing.lg,
    paddingVertical: 14,
    marginBottom: 20,
  },
  summaryItem: {
    alignItems: 'flex-start',
  },
  summaryValue: {
    fontSize: 44,
    fontFamily: 'CormorantGaramond_400Regular',
    fontVariant: ['tabular-nums'],
    color: sc.textPrimary,
  },
  summaryLabel: {
    fontSize: 13,
    color: sc.textMuted,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
});
