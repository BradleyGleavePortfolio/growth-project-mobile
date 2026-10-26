/** Now -> Suggested, the one fact of a plan change (CP-A-20), shared by the client's card and the coach's row. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius, typography } from '../../../theme/tokens';
import { COPILOT_COPY as C } from './pathChangeWords';
import { ledger } from './ledger';

/** Style A's change tiles on the client's card (.ba; Sol B-G2, Opus B-878R2-G2). */
const BA = { now: '#F5F6F1', nextLine: '#D2E2B4' } as const;

/**
 * `inset`: the tiles sit on the coach's grey panel, so Now is white there and its own look stays. The client's card
 * draws style A's tiles: Now #F5F6F1, Suggested leaf with the #D2E2B4 hairline, both labels 12 in #5A5A56 with no
 * tracking, both values 15.5 semibold in ink, a 20 moss arrow.
 */
export function ChangeTiles({ from, to, inset = false }: { from: string; to: string; inset?: boolean }) {
  const { semanticColors: sc } = useTheme();
  const label = (next: boolean) => (inset ? [typography.caption, { color: next ? forestPop.forest : sc.textMuted }] : [s.label, { color: ledger.muted }]);
  const value = (next: boolean) => (inset ? [typography.bodyMd, s.value, { color: next ? forestPop.forest : sc.textPrimary }] : [s.figure, { color: sc.textPrimary }]);
  return (
    <View style={s.row} accessible accessibilityLabel={`${C.now}, ${from}. ${C.next}, ${to}.`} testID="copilot-tiles">
      <View style={[s.tile, { backgroundColor: inset ? sc.bgSurface : BA.now }]} testID="copilot-tile-now">
        <Text style={label(false)}>{C.now}</Text>
        <Text style={value(false)}>{from}</Text>
      </View>
      <Ionicons name="arrow-forward" size={inset ? 16 : 20} color={forestPop.moss} style={s.arrow} testID="copilot-tiles-arrow" />
      <View style={[s.tile, { backgroundColor: pathTint.leaf, borderColor: inset ? forestPop.leaf : BA.nextLine, borderWidth: 1 }]} testID="copilot-tile-next">
        <Text style={label(true)}>{C.next}</Text>
        <Text style={value(true)}>{to}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Stretch: both tiles keep one height when a value wraps at large text.
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  arrow: { alignSelf: 'center' },
  tile: { flex: 1, borderRadius: radius.button, paddingHorizontal: 12, paddingVertical: 10, gap: 2, minHeight: 56, justifyContent: 'center' },
  value: { fontWeight: '600' },
  // .ba small, .ba b
  label: { fontFamily: 'Inter_400Regular', fontWeight: '400', fontSize: 12, lineHeight: 16 },
  figure: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 15.5, lineHeight: 20 },
});
