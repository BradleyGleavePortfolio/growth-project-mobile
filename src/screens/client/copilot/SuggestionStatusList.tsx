/**
 * "Suggestions" (style A frame 05): every change the client sent, newest first, with where it stands. Each row is one
 * read-only fact: the change, its status line (waiting / approved / kept / expired) and the coach's one-line note.
 * A status that is new or changes fades in and is said once, politely (GOAL index section 3; Sol B-S4).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius } from '../../../theme/tokens';
import type { CopilotSuggestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, describeChange, statusLine, type StatusTone } from './pathChangeWords';
import { ledger, ledgerType } from './ledger';
import { CalmIn, useSayOnChange } from './RomanNotice';

const TONE: Record<StatusTone, { icon: 'time-outline' | 'checkmark' | 'remove-circle-outline'; bg: string; ink: string }> = {
  waiting: { icon: 'time-outline', bg: ledger.wait, ink: forestPop.goldInk },
  approved: { icon: 'checkmark', bg: pathTint.leaf, ink: forestPop.forest },
  still: { icon: 'remove-circle-outline', bg: ledger.still, ink: ledger.muted },
};

export function SuggestionStatusList({ items, coach, now }: { items: CopilotSuggestion[]; coach: string; now?: Date }) {
  const { semanticColors: sc } = useTheme();
  // A row that is new, or whose status changed, is said once: the change and where it stands.
  useSayOnChange(items.map((i) => `${describeChange(i.change).summary}. ${statusLine(i, coach, now).line}`));
  return (
    <View style={s.wrap} testID="copilot-status-list">
      <Text style={[ledgerType.section, { color: sc.textPrimary }]} accessibilityRole="header">{C.suggestions}</Text>
      <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]} accessibilityLiveRegion="polite">
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
                <CalmIn key={item.status}>
                  <Text style={[ledgerType.status, s.line, { color: tone.ink }]} testID={`copilot-status-${item.status}-line`}>{st.line}</Text>
                </CalmIn>
                {note ? (
                  <View style={[s.quote, { borderColor: forestPop.gold }]}>
                    <Text style={[ledgerType.status, s.note, { color: ledger.ink }]}>{`\u201C${note}\u201D`}</Text>
                  </View>
                ) : null}
                {st.meta ? <Text style={[ledgerType.meta, s.meta, { color: ledger.muted }]}>{st.meta}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // .sec sits 22 under what is above it (the page's gap is 16; Opus B-878-G); its heading 10 over the card.
  wrap: { gap: 10, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  // Style A's status rows (.stl, .stl .ic, .note; Sol B-G2).
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // .stl .s 3 under the title, .note 8, .stl .d 2 (Opus B-878-G).
  text: { flex: 1 },
  line: { marginTop: 3 },
  meta: { marginTop: 2 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 2, marginTop: 8 },
  note: { fontWeight: '400', lineHeight: 19 },
});
