/**
 * The client's suggested plan change (style A frame 04): what would change, that nothing changes until the coach says
 * yes, what the coach will see, and one forest button that sends it. Roman never applies a change.
 *
 * Seam for COPILOT-M2: mount it under Roman's answer with the done frame's suggestion (status `suggested`). The source
 * tags (CP-A-16) are M2's; this card draws none until then.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius } from '../../../theme/tokens';
import { TextLink } from '../../../ui/buttons/PrimaryButton';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { aiRefusalOf, type AiRefusal } from '../../../lib/ai/aiRefusal';
import { copilotApi, copilotErrorOf, type CopilotSuggestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, describeChange, when } from './pathChangeWords';
import { ChangeTiles } from './ChangeTiles';
import { SourceTag } from './AnswerCard';
import { ledger, ledgerType } from './ledger';
import { CalmIn, CopilotRefusal, LedgerButton, RomanNotice, useSayOnChange } from './RomanNotice';

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
  const sentLine = sent ? C.sent(coach, when(sent.sent_at ?? new Date().toISOString())) : '';
  useSayOnChange(sentLine);

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
      <CalmIn style={s.sentAt}>
        <View style={[s.pill, { backgroundColor: pathTint.leaf }]} accessibilityRole="text" accessibilityLiveRegion="polite" testID="copilot-sent">
          <Ionicons name="checkmark" size={16} color={forestPop.forest} />
          <Text style={[ledgerType.sent, { color: forestPop.forest, flexShrink: 1 }]}>{sentLine}</Text>
        </View>
      </CalmIn>
    );
  }

  const d = describeChange(suggestion.change);
  const kinds = Array.from(new Set((suggestion.change.sources ?? []).map((x) => x.kind))); // CP-A-16, as frame 04 draws them
  // A refused or failed Send is Roman's notice under the card, the one way forward in it (GOAL index 2.2, Sol B-S3):
  // AI help off asks for AI help and Send comes back after the grant, never sent by itself; a failure's Try again
  // sends once more; a lapsed change keeps its words with no Send. One forest button on the screen at a time.
  const sendButton = refusal || line || gone ? null : (
    <LedgerButton label={C.send(coach)} onPress={() => void onSend()} loading={busy} style={s.send} testID="copilot-send" />
  );
  return (
    <View style={s.stack}>
      <View style={[s.card, { borderColor: forestPop.moss, backgroundColor: ledger.card }]} testID="copilot-suggestion">
        <View style={s.head}>
          <View style={s.eyebrow}>
            <Ionicons name="sparkles-outline" size={16} color={forestPop.goldInk} testID="copilot-suggestion-spark" />
            <Text style={[ledgerType.label, { color: forestPop.goldInk }]}>{C.suggested}</Text>
          </View>
          <Text style={[ledgerType.badge, s.badge, { color: ledger.muted, borderColor: ledger.line }]} testID="copilot-not-applied">{C.notApplied}</Text>
        </View>
        <Text style={[ledgerType.change, s.title, { color: sc.textPrimary }]} accessibilityRole="header" testID="copilot-suggestion-title">{d.title}</Text>
        <View style={s.next}><ChangeTiles from={d.from} to={d.to} /></View>
        {kinds.length ? <View style={[s.tags, s.next]} testID="copilot-suggestion-tags">{kinds.map((k) => <SourceTag key={k} kind={k} />)}</View> : null}
        <Text style={[ledgerType.privacy, s.next, { color: ledger.muted }]}>{`${C.nothingYet(coach)} ${C.privacy(coach)}`}</Text>
        {sendButton}
        {onDismiss ? <TextLink label={C.notNow} onPress={onDismiss} tone="muted" align="center" disabled={busy} testID="copilot-not-now" /> : null}
      </View>
      {refusal ? <CopilotRefusal refusal={refusal} onRetry={() => setRefusal(null)} testID="copilot-send-refusal" /> : null}
      {line ? (
        <RomanNotice body={line} testID="copilot-send-error">
          {gone ? null : <LedgerButton label="Try again" onPress={() => void onSend()} loading={busy} testID="copilot-send-retry" />}
        </RomanNotice>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  stack: { gap: 12 },
  // Style A's card rhythm (.sug, .sug h3, .ba, .srcs, .pv, .btn; Opus B-878-G): title 10, tiles, tags and privacy 12,
  // Send 14.
  card: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.card, padding: 16 },
  title: { marginTop: 10 },
  next: { marginTop: 12 },
  send: { marginTop: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // Style A (.na, .sentl; Sol B-G2).
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 12, minHeight: 36 },
  // .sentl sits 10 under what is above it; the turn's own gap is 12.
  sentAt: { marginTop: -2 },
});
