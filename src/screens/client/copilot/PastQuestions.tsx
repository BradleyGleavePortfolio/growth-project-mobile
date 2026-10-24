/**
 * Past questions (style A frames 13-14): the row on "Your path" with the total, and the list grouped by month,
 * newest first, 20 a page with "Show older questions", each with its outcome when Roman suggested a change.
 * One query for both (GET /client/copilot/questions, backend #1129); null = an older server, nothing drawn.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTheme } from '../../../theme/ThemeProvider';
import { forestPop, pathTint, radius, typography } from '../../../theme/tokens';
import { PrimaryButton, TextLink } from '../../../ui/buttons/PrimaryButton';
import RomanAvatar from '../../../components/roman/RomanAvatar';
import { copilotApi, type PastQuestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, shortDay } from './pathChangeWords';
import { ASK_COPY as A, monthYear } from './askWords';
import { ledger, ledgerType } from './ledger';

export const COPILOT_QUESTIONS_KEY = ['copilot', 'questions'] as const;

export function usePastQuestions() {
  return useInfiniteQuery({
    queryKey: COPILOT_QUESTIONS_KEY,
    queryFn: ({ pageParam }) => copilotApi.questions(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    // Chat words: never saved to the phone, and dropped when the chat is erased (copilotErasure.ts).
    meta: { persist: false },
  });
}

/** "Past questions · 186" on Your path (CP-A-44). Hidden until there is one. */
export function PastQuestionsRow({ total, onPress }: { total: number; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${A.past}, ${total}`} testID="copilot-past-row"
      style={({ pressed }) => [s.card, s.row, { backgroundColor: pressed ? sc.bgPrimary : ledger.card, borderColor: ledger.line }]}>
      <Text style={[typography.body, s.grow, { color: sc.textPrimary }]}>{A.past}</Text>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{total.toLocaleString('en-US')}</Text>
      <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
    </Pressable>
  );
}

/**
 * A declined change says "Your coach", never today's coach by name: the server does not say who declined,
 * and a question asked under an earlier coach was decided by them (#852 round 1, C1).
 */
function outcomeOf(q: PastQuestion): { text: string; bg: string; ink: string } | null {
  if (q.outcome === 'approved') return { text: C.approved, bg: pathTint.leaf, ink: forestPop.forest };
  if (q.outcome === 'rejected') return { text: C.declined(C.yourCoach), bg: ledger.still, ink: ledger.muted };
  if (q.outcome === 'pending') return { text: C.waiting, bg: pathTint.gold, ink: forestPop.goldInk };
  return null;
}

/** The month groups of the loaded pages (a question removed with its message has no words to show). */
export function PastQuestionsList({ items, onOpen, more, loadingMore, onMore }: {
  items: PastQuestion[]; onOpen: (q: PastQuestion) => void; more: boolean; loadingMore: boolean; onMore: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const groups: Array<{ month: string; rows: PastQuestion[] }> = [];
  for (const q of items) {
    if (!q.question) continue;
    const month = monthYear(q.askedAt, true);
    if (groups[groups.length - 1]?.month !== month) groups.push({ month, rows: [] });
    groups[groups.length - 1].rows.push(q);
  }
  return (
    <View style={s.list} testID="copilot-past-list">
      {groups.map((g, gi) => (
        <View key={g.month}>
          <Text style={[ledgerType.month, gi > 0 && s.monthGap, s.month, { color: ledger.muted }]} accessibilityRole="header">{g.month}</Text>
          <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]}>
            {g.rows.map((q, i) => {
              const out = outcomeOf(q);
              const day = shortDay(q.askedAt);
              return (
                <Pressable key={q.messageId} onPress={() => onOpen(q)} accessibilityRole="button" testID={`copilot-past-${q.messageId}`}
                  accessibilityLabel={[q.question, day, out?.text].filter(Boolean).join('. ')}
                  style={({ pressed }) => [s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: ledger.line }, pressed && { backgroundColor: sc.bgPrimary }]}>
                  <View style={s.grow}>
                    <Text style={[ledgerType.row, { color: sc.textPrimary }]}>{q.question}</Text>
                    <View style={s.meta}>
                      <Text style={[ledgerType.small, { color: ledger.muted }]}>{day}</Text>
                      {out ? <Text style={[ledgerType.outcome, s.pill, { backgroundColor: out.bg, color: out.ink }]} testID={`copilot-past-${q.messageId}-outcome`}>{out.text}</Text> : null}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {more ? <TextLink label={A.older} onPress={onMore} disabled={loadingMore} align="center" testID="copilot-past-more" style={s.older} /> : null}
    </View>
  );
}

/**
 * A history read that failed (the list, a page of older questions, or one answer): Roman's white ledger notice with
 * the approved words and a filled Try again (style A .stc, #852 round 3 B-H2), not the app's plain quiet line. The
 * words and what Try again reads are the caller's.
 */
export function LedgerRetry({ message, onRetry, retrying, testID }: { message: string; onRetry: () => void; retrying: boolean; testID: string }) {
  return (
    <View style={[s.notice, { backgroundColor: ledger.card, borderColor: ledger.line }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <View style={s.noticeHead}>
        <RomanAvatar crop="neutral" size={40} testID={`${testID}-roman`} />
        <Text style={[ledgerType.body, s.grow, { color: ledger.ink }]}>{message}</Text>
      </View>
      <PrimaryButton label="Try again" onPress={onRetry} disabled={retrying} haptic={false} wrap testID={`${testID}-retry`} />
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 0 },
  // Style A history (.hist .m, .hrow, .ot; #852 round 3 B-H1): 18 above a month, 8 under it.
  month: { paddingBottom: 8 },
  monthGap: { paddingTop: 18 },
  older: { marginTop: 8 },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  grow: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  notice: { borderWidth: 1, borderRadius: radius.card, paddingVertical: 20, paddingHorizontal: 18, gap: 14 },
  noticeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
});
