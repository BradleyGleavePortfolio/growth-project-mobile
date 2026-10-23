/**
 * Roman's Copilot answer (style A frame 03): Roman's face and name, the first sentence as the serif lead, the rest,
 * then "From your data" with one row per fact Roman cited (CP-A-15/16; the label and detail are the server's words,
 * CP-A-17). An older server sends no facts: the plain reply shows as it came. A safety reply keeps its crisis buttons.
 * `compact` (an answer that offers a change, frame 04, Sol B-851-G2): the answer as plain body text and no facts tray;
 * the suggestion card under it carries the source tags, so its Send stays in the first screenful.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, radius, typography } from '../../../theme/tokens';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import RomanCrisisActions from '../../../components/roman/RomanCrisisActions';
import type { RomanSafetyAction } from '../../../api/romanSafetyActions';
import type { CopilotReply, SourceKind } from '../../../api/copilotApi';
import { ASK_COPY as A, SOURCE_TAG, leadAndRest, withoutCites, withoutEmphasis } from './askWords';
import { ledger } from './ledger';

const TAG: Record<SourceKind, { bg: string; ink: string }> = {
  plan: { bg: forestPop.forest, ink: forestPop.onDeep },
  check_in: { bg: forestPop.gold, ink: forestPop.ink },
  food_log: { bg: forestPop.leaf, ink: forestPop.ink },
  workout_log: { bg: forestPop.moss, ink: forestPop.onDeep },
};

export function SourceTag({ kind }: { kind: SourceKind }) {
  return (
    <View style={[s.tag, { backgroundColor: TAG[kind].bg }]}>
      <Text style={[typography.caption, s.tagText, { color: TAG[kind].ink }]} maxFontSizeMultiplier={1.3}>{SOURCE_TAG[kind]}</Text>
    </View>
  );
}

export function AnswerCard({ text, reply, safety, compact = false }: {
  text: string; reply: CopilotReply | null; safety?: readonly RomanSafetyAction[]; compact?: boolean;
}) {
  const { semanticColors: sc } = useTheme();
  const plain = withoutEmphasis(text);
  const { lead, rest } = !reply ? { lead: '', rest: plain } : compact ? { lead: '', rest: withoutCites(plain) } : leadAndRest(withoutCites(plain));
  return (
    <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]} testID="copilot-answer">
      <View style={s.pad}>
        <View style={s.who} accessible accessibilityLabel={A.roman}>
          <RomanAvatar crop="neutral" size={28} />
          <Text style={[typography.bodySmall, s.name, { color: sc.textPrimary }]}>{A.roman}</Text>
        </View>
        {lead ? <Text style={[typography.h2, { color: sc.textPrimary }]} testID="copilot-lead">{lead}</Text> : null}
        {rest ? <Text style={[typography.body, { color: sc.textPrimary }]}>{rest}</Text> : null}
        {safety?.length ? <RomanCrisisActions actions={safety} testID="copilot-crisis" /> : null}
      </View>
      {reply && reply.sources.length > 0 && !compact ? (
        <View style={[s.facts, { borderColor: ledger.line }]} testID="copilot-facts">
          <Text style={[typography.bodySmall, s.name, { color: sc.textMuted }]} accessibilityRole="header">{A.fromData}</Text>
          {reply.sources.map((f, i) => (
            <View key={`${f.n}-${i}`} style={[s.fact, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: ledger.line }]}
              accessible accessibilityLabel={[SOURCE_TAG[f.kind], f.label, f.detail].filter(Boolean).join('. ')} testID={`copilot-fact-${f.kind}`}>
              <SourceTag kind={f.kind} />
              <View style={s.factText}>
                <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>{f.label}</Text>
                {f.detail ? <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{f.detail}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  pad: { padding: 16, gap: 10 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontWeight: '600' },
  facts: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  factText: { flex: 1 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minWidth: 84, alignItems: 'center' },
  tagText: { letterSpacing: 0.2, fontWeight: '600' },
});
