import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, colors } from '../../theme/index';
import type { MacroDisplayMode } from '../../macros/macroDisplay';

interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Props {
  dailyTotals: DailyTotals;
  remaining: number;
  /**
   * 'simple' during a never-tracker's first week (clinic contract v1
   * addition 8): calories and protein only. Defaults to 'full'.
   */
  mode?: MacroDisplayMode;
}

export default function DailySummaryBar({
  dailyTotals,
  remaining,
  mode = 'full',
}: Props) {
  const simple = mode === 'simple';
  return (
    <View
      style={styles.summaryBar}
      testID={simple ? 'daily-summary-simple' : 'daily-summary-full'}
    >
      <View style={styles.summaryItem}>
        <Text style={styles.summaryValue}>
          {Math.round(dailyTotals.calories)}
        </Text>
        <Text style={styles.summaryLabel}>Eaten</Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryItem}>
        <Text style={[styles.summaryValue, { color: Colors.primary }]}>
          {Math.round(remaining)}
        </Text>
        <Text style={styles.summaryLabel}>Remaining</Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryItem}>
        <Text style={[styles.summaryValue, { color: Colors.orange }]}>
          {Math.round(dailyTotals.protein)}g
        </Text>
        <Text style={styles.summaryLabel}>Protein</Text>
      </View>
      {simple ? null : (
        <>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: Colors.gold }]}>
              {Math.round(dailyTotals.carbs)}g
            </Text>
            <Text style={styles.summaryLabel}>Carbs</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: colors.data.habit }]}>
              {Math.round(dailyTotals.fat)}g
            </Text>
            <Text style={styles.summaryLabel}>Fat</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginBottom: 20,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.dark,
  },
  summaryLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
});
