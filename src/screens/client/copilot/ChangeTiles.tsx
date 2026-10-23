/** Now -> Suggested, the one fact of a plan change (CP-A-20), shared by the client's card and the coach's row. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius, typography } from '../../../theme/tokens';
import { COPILOT_COPY as C } from './pathChangeWords';
import { ledger } from './ledger';

/** `inset`: the tiles sit on the coach's grey panel, so Now is white there and grey on a white card. */
export function ChangeTiles({ from, to, inset = false }: { from: string; to: string; inset?: boolean }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={s.row} accessible accessibilityLabel={`${C.now}, ${from}. ${C.next}, ${to}.`}>
      <View style={[s.tile, { backgroundColor: inset ? ledger.card : pathTint.still }]}>
        <Text style={[typography.caption, { color: sc.textMuted }]}>{C.now}</Text>
        <Text style={[typography.bodyMd, s.value, { color: sc.textPrimary }]}>{from}</Text>
      </View>
      <Ionicons name="arrow-forward" size={16} color={forestPop.moss} style={s.arrow} />
      <View style={[s.tile, { backgroundColor: pathTint.leaf, borderColor: forestPop.leaf, borderWidth: 1 }]}>
        <Text style={[typography.caption, { color: forestPop.forest }]}>{C.next}</Text>
        <Text style={[typography.bodyMd, s.value, { color: forestPop.forest }]}>{to}</Text>
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
});
