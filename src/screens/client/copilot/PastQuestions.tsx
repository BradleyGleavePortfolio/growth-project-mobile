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
import { TextLink } from '../../../ui/buttons/PrimaryButton';
import { copilotApi, type PastQuestion } from '../../../api/copilotApi';
import { COPILOT_COPY as C, shortDay } from './pathChangeWords';
import { ASK_COPY as A, monthYear } from './askWords';

export const COPILOT_QUESTIONS_KEY = ['copilot', 'questions'] as const;

export function usePastQuestions() {
  return useInfiniteQuery({
    queryKey: COPILOT_QUESTIONS_KEY,
    queryFn: ({ pageParam }) => copilotApi.questions(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
  });
}

/** "Past questions · 186" on Your path (CP-A-44). Hidden until there is one. */
export function PastQuestionsRow({ total, onPress }: { total: number; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${A.past}, ${total}`} testID="copilot-past-row"
      style={({ pressed }) => [s.card, s.row, { backgroundColor: pressed ? sc.bgPrimary : sc.bgSurface, borderColor: sc.border }]}>
      <Text style={[typography.body, s.grow, { color: sc.textPrimary }]}>{A.past}</Text>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{total.toLocaleString('en-US')}</Text>
      <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
    </Pressable>
  );
}

function outcomeOf(q: PastQuestion, coach: string): { text: string; bg: string; ink: string } | null {
  if (q.outcome === 'approved') return { text: C.approved, bg: pathTint.leaf, ink: forestPop.forest };
  if (q.outcome === 'rejected') return { text: C.declined(coach), bg: pathTint.still, ink: forestPop.n700 };
  if (q.outcome === 'pending') return { text: C.waiting, bg: pathTint.gold, ink: forestPop.goldInk };
  return null;
}

/** The month groups of the loaded pages (a question removed with its message has no words to show). */
export function PastQuestionsList({ items, coach, onOpen, more, loadingMore, onMore }: {
  items: PastQuestion[]; coach: string; onOpen: (q: PastQuestion) => void; more: boolean; loadingMore: boolean; onMore: () => void;
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
      {groups.map((g) => (
        <View key={g.month} style={s.group}>
          <Text style={[typography.bodySmall, s.strong, { color: sc.textMuted }]} accessibilityRole="header">{g.month}</Text>
          <View style={[s.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
            {g.rows.map((q, i) => {
              const out = outcomeOf(q, coach);
              const day = shortDay(q.askedAt);
              return (
                <Pressable key={q.messageId} onPress={() => onOpen(q)} accessibilityRole="button" testID={`copilot-past-${q.messageId}`}
                  accessibilityLabel={[q.question, day, out?.text].filter(Boolean).join('. ')}
                  style={({ pressed }) => [s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: sc.border }, pressed && { backgroundColor: sc.bgPrimary }]}>
                  <View style={s.grow}>
                    <Text style={[typography.body, { color: sc.textPrimary }]}>{q.question}</Text>
                    <View style={s.meta}>
                      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{out ? `${day} ·` : day}</Text>
                      {out ? <Text style={[typography.caption, s.pill, { backgroundColor: out.bg, color: out.ink }]}>{out.text}</Text> : null}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {more ? <TextLink label={A.older} onPress={onMore} disabled={loadingMore} align="center" testID="copilot-past-more" /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 20 },
  group: { gap: 8 },
  strong: { fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  grow: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  pill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden', letterSpacing: 0.2 },
});
