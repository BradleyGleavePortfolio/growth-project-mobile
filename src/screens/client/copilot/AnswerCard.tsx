/**
 * Roman's Copilot answer (style A frame 03): Roman's face and name, the first sentence as the serif lead, the rest,
 * then "From your data" with one row per fact Roman cited (CP-A-15/16; the label and detail are the server's words,
 * CP-A-17). An older server sends no facts: the plain reply shows as it came. A safety reply keeps its crisis buttons.
 * `compact` (an answer that offers a change, frame 04, Sol B-851-G2): the answer as plain body text and no facts tray;
 * the suggestion card under it carries the source tags, so its Send stays in the first screenful.
 */
import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, radius } from '../../../theme/tokens';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import RomanCrisisActions from '../../../components/roman/RomanCrisisActions';
import type { RomanSafetyAction } from '../../../api/romanSafetyActions';
import type { CopilotReply, SourceKind } from '../../../api/copilotApi';
import { ASK_COPY as A, SOURCE_TAG, leadAndRest, withoutCites, withoutEmphasis } from './askWords';
import { ledger, ledgerType } from './ledger';

const TAG: Record<SourceKind, { bg: string; ink: string }> = {
  plan: { bg: forestPop.forest, ink: forestPop.onDeep },
  check_in: { bg: forestPop.gold, ink: forestPop.ink },
  food_log: { bg: forestPop.leaf, ink: forestPop.ink },
  workout_log: { bg: forestPop.moss, ink: forestPop.onDeep },
};

/** Style A's tag is 74 wide at least, in text units (.tag min-width §74), so it grows with the label (Opus B-878R3-2). */
const TAG_TEXT_MAX = 1.3;

export function SourceTag({ kind }: { kind: SourceKind }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[s.tag, { minWidth: 74 * Math.min(Math.max(fontScale, 1), TAG_TEXT_MAX), backgroundColor: TAG[kind].bg }]} testID={`copilot-tag-${kind}`}>
      <Text style={[ledgerType.tag, { color: TAG[kind].ink }]} maxFontSizeMultiplier={TAG_TEXT_MAX}>{SOURCE_TAG[kind]}</Text>
    </View>
  );
}

/** A compact answer reads as one paragraph; a list keeps its lines. */
const oneParagraph = (x: string) => (/^\s*[-*\u2022]\s/m.test(x) ? x : x.replace(/\s*\n+\s*/g, ' ').trim());

export function AnswerCard({ text, reply, safety, compact = false }: {
  text: string; reply: CopilotReply | null; safety?: readonly RomanSafetyAction[]; compact?: boolean;
}) {
  const { semanticColors: sc } = useTheme();
  const plain = withoutEmphasis(text);
  const { lead, rest } = !reply ? { lead: '', rest: plain } : compact ? { lead: '', rest: oneParagraph(withoutCites(plain)) } : leadAndRest(withoutCites(plain));
  return (
    <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]} testID="copilot-answer">
      <View style={s.pad}>
        <View style={s.who} accessible accessibilityLabel={A.roman}>
          <RomanAvatar crop="neutral" size={24} testID="copilot-answer-roman" />
          <Text style={[ledgerType.head, { color: forestPop.forest }]}>{A.roman}</Text>
        </View>
        {lead ? <Text style={[ledgerType.lead, { color: sc.textPrimary }]} testID="copilot-lead">{lead}</Text> : null}
        {rest ? <Text style={[ledgerType.body, { color: ledger.ink }]} testID="copilot-answer-body">{rest}</Text> : null}
        {safety?.length ? <RomanCrisisActions actions={safety} testID="copilot-crisis" /> : null}
      </View>
      {reply && reply.sources.length > 0 && !compact ? (
        <View style={[s.facts, { borderColor: ledger.line }]} testID="copilot-facts">
          <Text style={[ledgerType.factsLabel, s.fy, { color: ledger.muted }]} accessibilityRole="header">{A.fromData}</Text>
          {reply.sources.map((f, i) => (
            <View key={`${f.n}-${i}`} style={[s.fact, i > 0 && { borderTopWidth: 1, borderColor: ledger.factLine }]}
              accessible accessibilityLabel={[SOURCE_TAG[f.kind], f.label, f.detail].filter(Boolean).join('. ')} testID={`copilot-fact-${f.kind}`}>
              <SourceTag kind={f.kind} />
              <View style={s.factText}>
                <Text style={[ledgerType.fact, { color: sc.textPrimary }]}>{f.label}</Text>
                {f.detail ? <Text style={[ledgerType.small, s.detail, { color: ledger.muted }]}>{f.detail}</Text> : null}
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
  // Style A's answer (.ans .hd, .lead, .body, .fy, .fact, .tag; Sol B-G2).
  pad: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  facts: { borderTopWidth: 1, paddingBottom: 2 },
  fy: { paddingHorizontal: 16, paddingTop: 11, paddingBottom: 3 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9, minHeight: 56 },
  factText: { flex: 1 },
  detail: { marginTop: 1 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center' },
});
