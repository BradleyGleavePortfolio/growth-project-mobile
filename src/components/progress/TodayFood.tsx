/**
 * TodayFood — today's intake against the targets that exist, as quiet
 * hairline rows (no ring, no colour per macro). WEIGH-KB U3: with no calorie
 * target there is no "of 2,000"; while loading or after a failed read the
 * numbers are not claimed.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { QuietRow } from '../../ui';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';

export interface TodayTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type TodayTargets = Partial<Record<keyof TodayTotals, number | null | undefined>>;
export type TodayState = 'loading' | 'ready' | 'error';

const ROWS: { key: keyof TodayTotals; label: string; unit: string }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
];

function amount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export default function TodayFood({
  state,
  totals,
  targets,
}: {
  state: TodayState;
  totals: TodayTotals;
  targets: TodayTargets;
}): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  if (state === 'error') {
    return (
      <Text style={[styles.note, { color: sc.textMuted }]} testID="progress-today-error">
        Today&apos;s food did not load. Pull down to try again.
      </Text>
    );
  }
  const anyTarget = ROWS.some(({ key }) => (targets[key] ?? 0) > 0);
  const nothingYet = ROWS.every(({ key }) => totals[key] === 0);
  if (state === 'ready' && nothingYet && !anyTarget) {
    return (
      <Text style={[styles.note, { color: sc.textMuted }]} testID="progress-today-empty">
        Nothing logged yet today.
      </Text>
    );
  }
  return (
    <View style={styles.rows} testID="progress-today-food">
      {ROWS.map(({ key, label, unit }) => {
        const target = targets[key];
        const hasTarget = typeof target === 'number' && target > 0;
        const value =
          state === 'loading'
            ? '—'
            : hasTarget
              ? `${amount(totals[key])} of ${amount(target)} ${unit}`
              : `${amount(totals[key])} ${unit}`;
        return (
          <QuietRow key={key} label={label} value={value} testID={`progress-today-${key}`} />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { marginTop: 4 },
  note: { ...typography.bodySmall, marginTop: 8 },
});
