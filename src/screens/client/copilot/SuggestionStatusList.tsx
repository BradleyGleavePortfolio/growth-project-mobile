/**
 * "Suggestions" (style A frame 05): every change the client sent, newest first, with where it stands. Each row is one
 * read-only fact: the change, its status line (waiting / approved / kept / expired) and the coach's one-line note.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius, typography } from '../../../theme/tokens';
import type { CopilotSuggestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, describeChange, statusLine, type StatusTone } from './pathChangeWords';
import { ledger } from './ledger';

const TONE: Record<StatusTone, { icon: 'time-outline' | 'checkmark' | 'remove-circle-outline'; bg: string; ink: string }> = {
  waiting: { icon: 'time-outline', bg: pathTint.gold, ink: forestPop.goldInk },
  approved: { icon: 'checkmark', bg: pathTint.leaf, ink: forestPop.forest },
  still: { icon: 'remove-circle-outline', bg: pathTint.still, ink: forestPop.n700 },
};

export function SuggestionStatusList({ items, coach, now }: { items: CopilotSuggestion[]; coach: string; now?: Date }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={s.wrap} testID="copilot-status-list">
      <Text style={[typography.bodyMd, s.heading, { color: sc.textPrimary }]} accessibilityRole="header">{C.suggestions}</Text>
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
                <Text style={[typography.bodyMd, s.title, { color: sc.textPrimary }]}>{title}</Text>
                <Text style={[typography.bodySmall, { color: tone.ink }]}>{st.line}</Text>
                {note ? (
                  <View style={[s.quote, { borderColor: forestPop.gold }]}>
                    <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>{`\u201C${note}\u201D`}</Text>
                  </View>
                ) : null}
                {st.meta ? <Text style={[typography.caption, { color: sc.textMuted }]}>{st.meta}</Text> : null}
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
  heading: { fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16 },
  tile: { width: 32, height: 32, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  title: { fontWeight: '600' },
  quote: { borderLeftWidth: 3, paddingLeft: 10, marginVertical: 4 },
});
