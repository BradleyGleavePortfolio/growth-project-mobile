/**
 * The client's suggested plan change (style A frame 04): what would change, that nothing changes until the coach says
 * yes, what the coach will see, and one forest button that sends it. Roman never applies a change.
 *
 * Seam for COPILOT-M2: mount it under Roman's answer with the done frame's suggestion (status `suggested`). The source
 * tags (CP-A-16) are M2's; this card draws none until then.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius } from '../../../theme/tokens';
import { PrimaryButton, TextLink } from '../../../ui/buttons/PrimaryButton';
import { HapticService } from '../../../ui/haptics/haptics.service';
import AiRefusalNotice from '../../../components/ai/AiRefusalNotice';
import { aiRefusalOf, type AiRefusal } from '../../../lib/ai/aiRefusal';
import { copilotApi, copilotErrorOf, type CopilotSuggestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, describeChange, when } from './pathChangeWords';
import { ChangeTiles } from './ChangeTiles';
import { SourceTag } from './AnswerCard';
import { ledger, ledgerType } from './ledger';

export interface SuggestionCardProps {
  suggestion: CopilotSuggestion;
  /** The coach's first name, or "your coach". */
  coach: string;
  onSent?: (row: CopilotSuggestion) => void;
  onDismiss?: () => void;
  send?: (id: string) => Promise<CopilotSuggestion>;
}

export function SuggestionCard({ suggestion, coach, onSent, onDismiss, send = copilotApi.send }: SuggestionCardProps) {
  const { semanticColors: sc } = useTheme();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<CopilotSuggestion | null>(suggestion.status === 'suggested' ? null : suggestion);
  const [refusal, setRefusal] = useState<AiRefusal | null>(null);
  const [line, setLine] = useState<string | null>(null);
  /** The server says the suggestion lapsed: its words stay, Send goes (asking again is Roman's job). */
  const [gone, setGone] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (sent) Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [sent, fade]);

  const onSend = async () => {
    setBusy(true);
    setRefusal(null);
    setLine(null);
    try {
      const row = await send(suggestion.id);
      void HapticService.success();
      setSent(row);
      onSent?.(row);
    } catch (err) {
      void HapticService.error();
      const r = aiRefusalOf(err);
      const e = copilotErrorOf(err);
      const lapsed = !r && e.code === 'COPILOT_SUGGESTION_EXPIRED' && !!e.message;
      if (r) setRefusal(r);
      else setLine(lapsed ? e.message : C.failed);
      if (lapsed) setGone(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Animated.View style={[s.pill, { opacity: fade, backgroundColor: pathTint.leaf }]} accessibilityRole="text" testID="copilot-sent">
        <Ionicons name="checkmark" size={16} color={forestPop.forest} />
        <Text style={[ledgerType.sent, { color: forestPop.forest, flexShrink: 1 }]}>{C.sent(coach, when(sent.sent_at ?? new Date().toISOString()))}</Text>
      </Animated.View>
    );
  }

  const d = describeChange(suggestion.change);
  const kinds = Array.from(new Set((suggestion.change.sources ?? []).map((x) => x.kind))); // CP-A-16, as frame 04 draws them
  return (
    <View style={[s.card, { borderColor: forestPop.moss, backgroundColor: ledger.card }]} testID="copilot-suggestion">
      <View style={s.head}>
        <View style={s.eyebrow}>
          <Ionicons name="sparkles-outline" size={14} color={forestPop.goldInk} />
          <Text style={[ledgerType.label, { color: forestPop.goldInk }]}>{C.suggested}</Text>
        </View>
        <Text style={[ledgerType.badge, s.badge, { color: ledger.muted, borderColor: ledger.line }]} testID="copilot-not-applied">{C.notApplied}</Text>
      </View>
      <Text style={[ledgerType.change, { color: sc.textPrimary }]} accessibilityRole="header" testID="copilot-suggestion-title">{d.title}</Text>
      <ChangeTiles from={d.from} to={d.to} />
      {kinds.length ? <View style={s.tags} testID="copilot-suggestion-tags">{kinds.map((k) => <SourceTag key={k} kind={k} />)}</View> : null}
      <Text style={[ledgerType.privacy, { color: ledger.muted }]}>{`${C.nothingYet(coach)} ${C.privacy(coach)}`}</Text>
      {refusal ? <AiRefusalNotice refusal={refusal} audience="client" surface="roman" onRetry={() => void onSend()} compact /> : null}
      {line ? <Text style={[ledgerType.privacy, { color: forestPop.error }]} accessibilityRole="alert" testID="copilot-send-error">{line}</Text> : null}
      {gone ? null : <PrimaryButton label={C.send(coach)} onPress={() => void onSend()} loading={busy} haptic={false} wrap testID="copilot-send" />}
      {onDismiss ? <TextLink label={C.notNow} onPress={onDismiss} tone="muted" align="center" disabled={busy} testID="copilot-not-now" /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.card, padding: 16, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // Style A (.na, .sentl; Sol B-G2).
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 36 },
});
