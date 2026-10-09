/**
 * BodyNumbers — the "Body" row of Progress (progress-details/luxury.jpg):
 * up to four serif tabular numbers, an overline above and the unit below,
 * divided by vertical hairlines. No boxes, no colour per value.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { QuietOverline } from '../../ui/sections/QuietSection';

export interface BodyNumberCell {
  key: string;
  label: string;
  value: string;
  unit?: string;
  testID?: string;
}

export default function BodyNumbers({ cells }: { cells: BodyNumberCell[] }): React.ReactElement | null {
  const { semanticColors: sc } = useTheme();
  if (cells.length === 0) return null;
  return (
    <View style={styles.row} testID="progress-body-numbers">
      {cells.map((cell, i) => (
        <View
          key={cell.key}
          accessible
          accessibilityLabel={`${cell.label} ${cell.value}${cell.unit ? ` ${cell.unit}` : ''}`}
          style={[styles.cell, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: sc.border }]}
        >
          <QuietOverline style={styles.overline} numberOfLines={1}>{cell.label}</QuietOverline>
          <Text
            testID={cell.testID}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={1.3}
            style={[styles.value, { color: sc.textPrimary }]}
          >
            {cell.value}
          </Text>
          {cell.unit ? <QuietOverline style={styles.unit}>{cell.unit}</QuietOverline> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', marginTop: 12 },
  cell: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  overline: { marginBottom: 6, textAlign: 'center' },
  value: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontWeight: '400',
    fontSize: 30,
    lineHeight: 38,
    fontVariant: ['lining-nums', 'tabular-nums'],
  },
  unit: { marginTop: 4, marginBottom: 0, textAlign: 'center' },
});
