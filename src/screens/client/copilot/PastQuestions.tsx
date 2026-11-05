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
import { forestPop, pathTint, radius } from '../../../theme/tokens';
import { copilotApi, type PastQuestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, shortDay } from './pathChangeWords';
import { ASK_COPY as A, monthYear } from './askWords';
import { ledger, ledgerType } from './ledger';
import { LedgerButton, LedgerLink, RomanNotice } from './RomanNotice';

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

/**
 * "Past questions · 186" on Your path (CP-A-44), style A's ask row (frame 13 .qrow: 52 tall, 16/1.3, the count 14 in
 * the muted grey with the moss chevron 6 beside it; Opus B-852R3-1), 14 under what is above it. Hidden until there is one.
 */
export function PastQuestionsRow({ total, onPress }: { total: number; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${A.past}, ${total}`} testID="copilot-past-row"
      style={({ pressed }) => [s.card, s.entry, { backgroundColor: pressed ? pathTint.leaf : ledger.card, borderColor: ledger.line }]}>
      <Text style={[ledgerType.ask, s.grow, { color: sc.textPrimary }]}>{A.past}</Text>
      <View style={s.count}>
        <Text style={[ledgerType.count, { color: ledger.muted }]} testID="copilot-past-row-count">{total.toLocaleString('en-US')}</Text>
        <Ionicons name="chevron-forward" size={18} color={forestPop.moss} testID="copilot-past-row-chevron" />
      </View>
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
  if (q.outcome === 'pending') return { text: C.waiting, bg: ledger.wait, ink: forestPop.goldInk };
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
                      {/* "Sun 18 Oct · Approved by your coach" (frame 14 .hrow small; Opus B-852R3-1). */}
                      <Text style={[ledgerType.small, { color: ledger.muted }]}>{out ? `${day} \u00B7` : day}</Text>
                      {out ? <Text style={[ledgerType.outcome, s.pill, { backgroundColor: out.bg, color: out.ink }]} testID={`copilot-past-${q.messageId}-outcome`}>{out.text}</Text> : null}
                    </View>
                  </View>
                  {/* .hrow's chevron: 22, the row's ink (frame 14). */}
                  <Ionicons name="chevron-forward" size={22} color={sc.textPrimary} testID={`copilot-past-${q.messageId}-chevron`} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {more ? <View style={s.older}><LedgerLink label={A.older} onPress={onMore} disabled={loadingMore} testID="copilot-past-more" /></View> : null}
    </View>
  );
}

/**
 * A history read that failed (the list, a page of older questions, or one answer): Roman's notice with the approved
 * words and Try again (style A .stc, #852 round 3 B-H2), the one notice every Copilot failure uses. The words and what
 * Try again reads are the caller's.
 */
export function LedgerRetry({ message, onRetry, retrying, testID }: { message: string; onRetry: () => void; retrying: boolean; testID: string }) {
  return (
    <RomanNotice body={message} testID={testID}>
      <LedgerButton label="Try again" onPress={onRetry} disabled={retrying} haptic={false} testID={`${testID}-retry`} />
    </RomanNotice>
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
  entry: { minHeight: 52, marginTop: -2, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grow: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
});
