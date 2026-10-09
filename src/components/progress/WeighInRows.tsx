/**
 * WeighInRows — recent weigh-ins as hairline rows: the day on the left (with
 * the note under it when there is one), the weight in serif tabular figures
 * on the right. Read-only, like "Recent check-ins" in progress-details.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';
import { formatWeight } from './progressFormat';

export interface WeighInRow {
  id: string;
  day: string; // already formatted, e.g. "Wed 7 Oct"
  weight: number;
  notes?: string;
}

export default function WeighInRows({ rows }: { rows: WeighInRow[] }): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return (
    <View testID="progress-weigh-ins">
      {rows.map((row, i) => (
        <View
          key={row.id}
          style={[styles.row, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border }]}
        >
          <View style={styles.left}>
            <Text style={[styles.day, { color: sc.textPrimary }]}>{row.day}</Text>
            {row.notes ? (
              <Text style={[styles.note, { color: sc.textMuted }]} numberOfLines={1}>{row.notes}</Text>
            ) : null}
          </View>
          <Text style={[styles.weight, { color: sc.textPrimary }]}>
            {formatWeight(row.weight)}
            <Text style={[styles.unit, { color: sc.textMuted }]}> lb</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingVertical: 12, gap: 16 },
  left: { flex: 1, gap: 2 },
  day: { ...typography.body, fontVariant: ['tabular-nums'] },
  note: { ...typography.bodySmall },
  weight: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontWeight: '400',
    fontSize: 22,
    lineHeight: 28,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  unit: { ...typography.bodySmall },
});
