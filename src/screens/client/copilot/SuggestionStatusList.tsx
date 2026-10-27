/**
 * "Suggestions" (style A frame 05): every change the client sent, newest first, with where it stands. Each row is one
 * read-only fact: the change, its status line (waiting / approved / kept / expired) and the coach's one-line note.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius } from '../../../theme/tokens';
import type { CopilotSuggestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, describeChange, statusLine, type StatusTone } from './pathChangeWords';
import { ledger, ledgerType } from './ledger';

const TONE: Record<StatusTone, { icon: 'time-outline' | 'checkmark' | 'remove-circle-outline'; bg: string; ink: string }> = {
  waiting: { icon: 'time-outline', bg: pathTint.gold, ink: forestPop.goldInk },
  approved: { icon: 'checkmark', bg: pathTint.leaf, ink: forestPop.forest },
  still: { icon: 'remove-circle-outline', bg: ledger.still, ink: ledger.muted },
};

export function SuggestionStatusList({ items, coach, now }: { items: CopilotSuggestion[]; coach: string; now?: Date }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={s.wrap} testID="copilot-status-list">
      <Text style={[ledgerType.section, { color: sc.textPrimary }]} accessibilityRole="header">{C.suggestions}</Text>
      <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]}>
        {items.map((item, i) => {
          const st = statusLine(item, coach, now);
          const tone = TONE[st.tone];
          const title = describeChange(item.change).summary;
          const note = item.status === 'rejected' && item.note ? item.note : null;
          return (
            <View key={item.id} style={[s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: ledger.line }]}
              accessible accessibilityLabel={[title, st.line, note, st.meta].filter(Boolean).join('. ')} testID={`copilot-status-${item.status}`}>
              <View style={[s.tile, { backgroundColor: tone.bg }]}>
                <Ionicons name={tone.icon} size={18} color={tone.ink} />
              </View>
              <View style={s.text}>
                <Text style={[ledgerType.statusTitle, { color: sc.textPrimary }]}>{title}</Text>
                <Text style={[ledgerType.status, { color: tone.ink }]} testID={`copilot-status-${item.status}-line`}>{st.line}</Text>
                {note ? (
                  <View style={[s.quote, { borderColor: forestPop.gold }]}>
                    <Text style={[ledgerType.status, s.note, { color: ledger.ink }]}>{`\u201C${note}\u201D`}</Text>
                  </View>
                ) : null}
                {st.meta ? <Text style={[ledgerType.meta, { color: ledger.muted }]}>{st.meta}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  // Style A's status rows (.stl, .stl .ic, .note; Sol B-G2).
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 2, marginTop: 5 },
  note: { fontWeight: '400', lineHeight: 19 },
});
