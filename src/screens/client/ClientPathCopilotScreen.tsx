/**
 * ClientPathCopilotScreen: "Your path" (Path Copilot style A, owner #162-1, board planning/MOCKUP3/COPILOT).
 *
 * The masthead holds the week block (frames 02, 13; it folds to two chips once a question is asked, frame 03). Below:
 * "Ask about your path" with the starter questions, Roman's answers with the facts he used (frame 03), the suggestion
 * card under an answer that offers a change (frame 04) and the sent suggestions (frame 05). Questions go through
 * Roman's normal send path with the Copilot opt-in header (backend #1129), in the client's open Roman chat.
 * Behind `featureFlags.clientPathCopilot` (off) and the server switch: a server without Copilot (404, or no
 * `copilot` on the reply) shows the plain Roman reply and no week block (truthful fallback). Coachless: Roman's lock.
 * A follow-up question scrolls into view as it is asked and keeps its place while the answer arrives.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forestPop, layout, pathTint, typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from '../../components/EmptyState';
import AiRefusalNotice from '../../components/ai/AiRefusalNotice';
import AiDailyCapModal from '../../components/ai/AiDailyCapModal';
import JoinCoachState, { ROMAN_LOCK_BODY, ROMAN_LOCK_TITLE, useClientNeedsCoach } from '../../components/coachless/JoinCoachState';
import RomanAvatar from '../../components/roman/RomanAvatar';
import RomanComposer from '../../components/roman/RomanComposer';
import RomanTypingIndicator from '../../components/roman/RomanTypingIndicator';
import {
  ROMAN_AI_ON_ASK_AGAIN, ROMAN_ERROR_TRANSIENT, ROMAN_OFFLINE_BODY, ROMAN_OFFLINE_TITLE, ROMAN_QUICK_STARTS, ROMAN_ROOM_FOOTER,
  ROMAN_STORED_NO_REPLY, romanPoolEmpty, romanRateLimited,
} from '../../components/roman/romanVoice';
import { ForestStatusBar } from '../../components/StatusBarBand';
import { PrimaryButton, Screen, useScreenInsets } from '../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../ui/states/QuietStates';
import { aiRefusalOf } from '../../lib/ai/aiRefusal';
import { featureFlags } from '../../config/featureFlags';
import { useMyCoaches } from '../../hooks/useCalendar';
import type { RomanApiError } from '../../api/romanApi';
import { copilotApi, type CopilotSuggestion } from '../../api/copilotApi';
import { COPILOT_COPY as C } from './copilot/pathChangeWords';
import { ASK_COPY as A, targetChangedOn, timeOf, withoutCites } from './copilot/askWords';
import { SuggestionStatusList } from './copilot/SuggestionStatusList';
import { SuggestionCard } from './copilot/SuggestionCard';
import { AnswerCard } from './copilot/AnswerCard';
import { WeekBlock } from './copilot/WeekBlock';
import { useCopilotAsk, type CopilotTurn } from './copilot/useCopilotAsk';

export const COPILOT_RECENT_KEY = ['copilot', 'recent'] as const;

/** The coach's first name for "Send to {coach}" and the status lines, or "your coach" when it is not known yet. */
export function useCoachFirstName(): string {
  const { data } = useMyCoaches();
  return data?.[0]?.name?.trim().split(/\s+/)[0] || C.yourCoach;
}

export default function ClientPathCopilotScreen() {
  if (!featureFlags.clientPathCopilot) {
    return (
      <View style={s.flagOff} accessibilityLabel="Path suggestions unavailable" accessibilityRole="none">
        <EmptyState icon="lock-closed-outline" title="Your path" subtitle="Path suggestions are not available on this account." />
      </View>
    );
  }
  return <PathCopilot />;
}

function CoachLock() {
  const navigation = useNavigation();
  return <JoinCoachState roman title={ROMAN_LOCK_TITLE} body={ROMAN_LOCK_BODY} onBack={() => navigation.goBack()} testID="copilot-coach-lock" />;
}

function PathCopilot() {
  return useClientNeedsCoach() ? <CoachLock /> : <PathView />;
}

/** The forest masthead: back, the serif title, then the week block. */
function Mast({ back, title, compact, children }: { back: string; title: string; compact?: boolean; children?: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  const insets = useScreenInsets();
  const navigation = useNavigation();
  const light = { color: sc.textOnAccent };
  return (
    <View style={[s.mast, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + 12 }]}>
      <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={`Back to ${back}`} style={s.back} testID="copilot-back">
        <Ionicons name="chevron-back" size={22} color={sc.textOnAccent} />
        <Text style={[typography.bodyMd, light]}>{back}</Text>
      </Pressable>
      <Text style={[compact ? typography.h2 : typography.h1, light]} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

function PathView() {
  const { semanticColors: sc } = useTheme();
  const qc = useQueryClient();
  const coach = useCoachFirstName();
  const q = useQuery({ queryKey: COPILOT_RECENT_KEY, queryFn: () => copilotApi.recent() });
  const { turns, busy, ask } = useCopilotAsk();
  const [draft, setDraft] = useState('');
  const refusal = q.error ? aiRefusalOf(q.error) : null;
  const week = q.data?.week ?? null;
  const items = q.data?.suggestions ?? [];
  const asked = turns.length > 0;
  const reveal = useReveal(turns);
  if (turns.some((t) => t.error?.kind === 'requiresCoach')) return <CoachLock />;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['copilot'] });
  // A stored question with no answer goes back in an empty composer: asking again is the client's call (main's rule).
  const onAsk = (text: string, retryId?: string) => void ask(text, retryId).then((o) => {
    if (o === 'sent') refresh();
    if (o === 'stored') setDraft((d) => (d.trim() === '' ? text : d));
  });
  const starters: string[] = [ROMAN_QUICK_STARTS[0], ROMAN_QUICK_STARTS[3]];
  if (targetChangedOn(week?.target ?? null)) starters.unshift(A.whyCalories);
  // A suggestion already shown under an answer is not listed a second time below.
  const underAnswers = new Set(turns.map((t) => t.answer?.reply?.suggestion?.id));
  const listed = items.filter((i) => !underAnswers.has(i.id));
  const composer = (
    <RomanComposer value={draft} onChangeText={setDraft} sending={busy} footer={ROMAN_ROOM_FOOTER} testID="copilot-composer"
      onSend={() => { const t = draft; setDraft(''); onAsk(t); }} />
  );

  return (
    <>
      <ForestStatusBar />
      <Screen edges={['bottom']} testID="copilot-screen" scroll={false} contentStyle={s.page} footer={composer}>
        <ScrollView ref={reveal.ref} style={s.grow} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} testID="copilot-scroll"
          onLayout={(e) => reveal.view(e.nativeEvent.layout.height)} onContentSizeChange={(_w, h) => reveal.content(h)}
          onScrollBeginDrag={reveal.stop}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={refresh} tintColor={sc.textMuted} />}>
          <Mast back={C.back} title={C.title} compact={asked}>{week ? <WeekBlock week={week} compact={asked} /> : null}</Mast>
          <View style={s.body} onLayout={(e) => reveal.body(e.nativeEvent.layout.y)}>
            {q.isPending ? <QuietLoading label="Loading your path" rows={2} testID="copilot-loading" /> : null}
            {refusal ? <AiRefusalNotice refusal={refusal} audience="client" surface="roman" onRetry={() => void q.refetch()} /> : null}
            {q.error && !refusal ? (
              <QuietError message={loadFailureMessage(q.error, 'Your path')} onRetry={() => void q.refetch()} retrying={q.isRefetching} testID="copilot-error" />
            ) : null}
            {turns.map((t, i) => (
              <View key={t.id} onLayout={(e) => reveal.turn(i, e.nativeEvent.layout.y)}>
                <Turn turn={t} coach={coach} onRetry={() => onAsk(t.question, t.id)} onSent={refresh} />
              </View>
            ))}
            {asked ? null : (
              <View style={s.section} testID="copilot-ask">
                <Text style={[typography.bodyMd, s.strong, { color: sc.textPrimary }]} accessibilityRole="header">{A.askHeading}</Text>
                <View style={[s.card, { backgroundColor: sc.bgSurface, borderColor: sc.border }]}>
                  {starters.map((label, i) => (
                    <Pressable key={label} onPress={() => onAsk(label)} disabled={busy} accessibilityRole="button" accessibilityLabel={label}
                      accessibilityState={{ disabled: busy }} testID={`copilot-starter-${i}`}
                      style={({ pressed }) => [s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
                        (pressed || label === A.whyCalories) && { backgroundColor: pathTint.leaf }]}>
                      <Text style={[typography.body, s.grow, { color: sc.textPrimary }, label === A.whyCalories && s.strong]}>{label}</Text>
                      <Ionicons name="chevron-forward" size={18} color={forestPop.forest} />
                    </Pressable>
                  ))}
                </View>
                <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{A.hint(coach)}</Text>
              </View>
            )}
            {listed.length > 0 ? <SuggestionStatusList items={listed} coach={coach} /> : null}
          </View>
        </ScrollView>
      </Screen>
    </>
  );
}

/**
 * Brings a follow-up question to the top of the view when it is asked (the first one already sits under the folded
 * masthead) and keeps following it while its answer grows, until the answer is in or the client scrolls.
 */
function useReveal(turns: CopilotTurn[]) {
  const ref = useRef<ScrollView>(null);
  const m = useRef({ body: 0, view: 0, content: 0, y: null as number | null, seen: 1 });
  const last = turns[turns.length - 1];
  const waiting = !!last && !last.answer && !last.error;
  const follow = () => {
    const r = m.current;
    if (r.y == null) return;
    ref.current?.scrollTo({ y: Math.max(0, Math.min(r.y, r.content - r.view)), animated: true });
    if (!waiting) r.y = null;
  };
  return {
    ref,
    body: (y: number) => { m.current.body = y; },
    view: (h: number) => { m.current.view = h; },
    content: (h: number) => { m.current.content = h; follow(); },
    stop: () => { m.current.y = null; },
    turn: (i: number, y: number) => {
      const r = m.current;
      if (i < r.seen || i !== turns.length - 1) return;
      r.seen = i + 1;
      r.y = r.body + y - 12;
      follow();
    },
  };
}

function Asked({ question, at }: { question: string; at: Date }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={s.asked}>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{A.youAsked(timeOf(at))}</Text>
      <Text style={[typography.h4, s.strong, { color: sc.textPrimary }]} accessibilityRole="header">{question}</Text>
    </View>
  );
}

/** Under an answer: the card while the change is unsent, its status line once it is sent or decided. */
function SuggestionSlot({ suggestion, coach, onSent, onDismiss }: {
  suggestion: CopilotSuggestion | null; coach: string; onSent?: () => void; onDismiss?: () => void;
}) {
  if (!suggestion) return null;
  return suggestion.status === 'suggested'
    ? <SuggestionCard suggestion={suggestion} coach={coach} onSent={onSent} onDismiss={onDismiss} />
    : <SuggestionStatusList items={[suggestion]} coach={coach} />;
}

function Turn({ turn, coach, onRetry, onSent }: { turn: CopilotTurn; coach: string; onRetry: () => void; onSent: () => void }) {
  const a = turn.answer;
  const [dismissed, setDismissed] = useState(false);
  // The answer is read out when it arrives, as the error card is (accessibilityRole alert).
  useEffect(() => { if (a) AccessibilityInfo.announceForAccessibility(withoutCites(a.text)); }, [a]);
  return (
    <View style={s.turn} testID="copilot-turn">
      <Asked question={turn.question} at={turn.askedAt} />
      {a ? <AnswerCard text={a.text} reply={a.reply} safety={a.safety} /> : null}
      {a && !dismissed ? (
        <SuggestionSlot suggestion={a.reply?.suggestion ?? null} coach={coach} onSent={onSent} onDismiss={() => setDismissed(true)} />
      ) : null}
      {turn.error ? <TurnError error={turn.error} onRetry={onRetry} /> : null}
      {!a && !turn.error ? <RomanTypingIndicator testID="copilot-typing" /> : null}
    </View>
  );
}

/**
 * Roman's own words for each failure (main), in a card under the question; the question stays. A question the server
 * already stored (`turnStored`) is never re-sent from here: main's stored line, no Try again, and after an AI-help
 * grant main's "ask again" line (RomanChatScreen, Sol B-326-3). Sending again is the client's call, from the composer.
 */
function TurnError({ error, onRetry }: { error: RomanApiError; onRetry: () => void }) {
  const { semanticColors: sc } = useTheme();
  const [capOpen, setCapOpen] = useState(true);
  const [granted, setGranted] = useState(false);
  const stored = error.turnStored === true;
  if (error.kind === 'aiRefused' && error.refusal && !granted) {
    return <AiRefusalNotice refusal={error.refusal} audience="client" surface="roman" onRetry={stored ? () => setGranted(true) : onRetry} testID="copilot-ai-refusal" />;
  }
  if (error.kind === 'dailyCap') {
    return <AiDailyCapModal cap={capOpen ? (error.dailyCap ?? null) : null} audience="client" onClose={() => setCapOpen(false)} testID="copilot-daily-cap" />;
  }
  const [title, body, retry]: [string, string, boolean] =
    error.kind === 'poolEmpty' ? [romanPoolEmpty('client'), '', false]
    : granted ? [ROMAN_AI_ON_ASK_AGAIN, '', false]
    : error.kind === 'rateLimited' ? [romanRateLimited(error.retryAfterSeconds), '', !stored]
    : stored ? [ROMAN_STORED_NO_REPLY, '', false]
    : error.kind === 'offline' ? [ROMAN_OFFLINE_TITLE, ROMAN_OFFLINE_BODY, true]
    : [ROMAN_ERROR_TRANSIENT, '', true];
  return (
    <View style={[s.card, s.pad, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} accessibilityRole="alert" testID={`copilot-turn-${error.kind}`}>
      <View style={s.who}>
        <RomanAvatar crop="neutral" size={28} />
        <Text style={[typography.bodyMd, s.strong, s.grow, { color: sc.textPrimary }]}>{title}</Text>
      </View>
      {body ? <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>{body}</Text> : null}
      {retry ? <PrimaryButton label="Try again" onPress={onRetry} testID="copilot-retry" /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  flagOff: { flex: 1, justifyContent: 'center' },
  page: { paddingHorizontal: 0, paddingBottom: 0 },
  scroll: { flexGrow: 1, paddingBottom: layout.gutter },
  mast: { paddingHorizontal: 20, paddingBottom: 24, gap: 8, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  back: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  body: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  section: { gap: 10 },
  turn: { gap: 12 },
  asked: { gap: 2 },
  strong: { fontWeight: '600' },
  grow: { flex: 1 },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  pad: { padding: 16, gap: 12 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
});
