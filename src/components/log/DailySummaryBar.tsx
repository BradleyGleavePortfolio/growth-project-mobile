import React from 'react';
import { View, StyleSheet } from 'react-native';
import { layout, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import QuietBar, { QuietText as Text } from '../../ui/progress/QuietBar';
import { QuietOverline } from '../../ui/sections/QuietSection';
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

/**
 * The day's one hero number (calories left, over, or eaten) in serif
 * display, with the macro bars quieter underneath. Same values and labels
 * as before; only the hierarchy changed.
 */
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
        <QuietOverline>{remaining == null ? 'Calories eaten' : remaining < 0 ? 'Calories over target' : 'Calories left'}</QuietOverline>
        <Text style={styles.summaryValue} maxFontSizeMultiplier={1.3}>
          {Math.round(remaining == null ? dailyTotals.calories : Math.abs(remaining))}
        </Text>
        {remaining != null || targets ? <Text style={styles.summaryLabel}>
          {targets ? `of ${targets.calories} · ` : ''}{Math.round(dailyTotals.calories)} eaten
        </Text> : <Text style={styles.summaryLabel}>No target</Text>}
      </View>
      <View style={styles.macros}>
        {(simple ? ['protein'] as const : ['protein', 'carbs', 'fat'] as const).map((key) => {
          const eaten = Math.round(dailyTotals[key]);
          const target = targets?.[key];
          const over = target != null && eaten > target ? ` · ${Math.round(eaten - target)} g over` : '';
          return <QuietBar key={key} label={key[0].toUpperCase() + key.slice(1)} current={dailyTotals[key]} target={target}
            value={`${eaten}g${target != null ? ` / ${target}g goal` : ''}${over}`} />;
        })}
      </View>
    </View>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  summaryBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    paddingTop: layout.sectionPadY,
    marginBottom: layout.sectionGap,
    gap: layout.sectionPadY,
  },
  summaryItem: {
    alignItems: 'flex-start',
  },
  summaryValue: {
    ...typography.display,
    // Cormorant defaults to old-style figures; the hero number reads as lining.
    fontVariant: ['lining-nums', 'tabular-nums'],
    color: sc.textPrimary,
  },
  summaryLabel: {
    fontSize: 13,
    lineHeight: 19,
    color: sc.textMuted,
    fontVariant: ['tabular-nums'],
  },
  macros: {
    gap: 14,
  },
});
