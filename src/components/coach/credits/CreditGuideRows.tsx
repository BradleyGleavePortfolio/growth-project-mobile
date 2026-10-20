/**
 * The "how AI credits work" rows in the S3 look: an italic serif label over
 * one plain line, hairlines between rows. Each row reads as one sentence to
 * a screen reader ("What uses them. Roman and AI features, ...").
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { spacing, typography } from '../../../theme/tokens';
import { useRomanVoiceFont } from '../../../screens/consultation/components';
import type { CreditGuideRow } from './creditCopy';

export default function CreditGuideRows({ rows, testID = 'credit-rows' }: { rows: readonly CreditGuideRow[]; testID?: string }) {
  const { semanticColors: sc } = useTheme();
  const italic = useRomanVoiceFont();
  return (
    <View testID={testID}>
      {rows.map((r) => (
        <View
          key={r.key}
          style={[styles.row, { borderTopColor: sc.border }]}
          accessible
          accessibilityLabel={`${r.label}. ${r.text}`}
          testID={`${testID}-${r.key}`}
        >
          <Text style={[styles.label, { color: sc.textPrimary, fontFamily: italic }]}>{r.label}</Text>
          <Text style={[styles.text, { color: sc.textPrimary }]}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  label: { ...typography.h3, fontFamily: typography.h2.fontFamily, fontWeight: '400', lineHeight: 26 },
  text: { ...typography.body, marginTop: spacing.xs },
});
