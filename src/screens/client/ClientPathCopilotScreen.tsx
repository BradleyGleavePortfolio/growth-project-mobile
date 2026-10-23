/**
 * ClientPathCopilotScreen: "Your path" (Path Copilot style A, owner #162-1, board planning/MOCKUP3/COPILOT).
 *
 * The masthead holds the week block (frames 02, 13; it folds to two chips once a question is asked, frame 03). Below:
 * "Ask about your path" with the starter questions, Roman's answers with the facts he used (frame 03), the suggestion
 * card under an answer that offers a change (frame 04), the sent suggestions (frame 05) and "Past questions" (14).
 * Questions go through Roman's normal send path with the Copilot opt-in header (backend #1129), in the client's
 * open Roman chat. One screen, three views on the same route: Your path, Past questions, and one past answer.
 * Behind `featureFlags.clientPathCopilot` (off) and the server switch: a server without Copilot (404, or no
 * `copilot` on the reply) shows the plain Roman reply and no week block (truthful fallback). Coachless: Roman's lock.
 * A follow-up question scrolls into view as it is asked and keeps its place while the answer arrives. When Settings
 * erases the chat the turns came from, they go (useCopilotAsk) and so does a question put back in the composer.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute, type ParamListBase, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forestPop, layout, pathTint, typography, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from '../../components/EmptyState';
import AiRefusalNotice from '../../components/ai/AiRefusalNotice';
import AiDailyCapModal from '../../components/ai/AiDailyCapModal';
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
import JoinCoachState, { ROMAN_LOCK_BODY, ROMAN_LOCK_TITLE, useClientNeedsCoach } from '../../components/coachless/JoinCoachState';
import type { RomanApiError } from '../../api/romanApi';
import { copilotApi, copilotErrorOf, type CopilotSuggestion, type PastQuestion } from '../../api/copilotApi';
import { romanChatsEvents } from '../settings/romanChatsEvents';
import { COPILOT_COPY as C, shortDay } from './copilot/pathChangeWords';
import { ASK_COPY as A, monthYear, targetChangedOn, timeOf, withoutCites } from './copilot/askWords';
import { SuggestionStatusList } from './copilot/SuggestionStatusList';
import { SuggestionCard } from './copilot/SuggestionCard';
import { AnswerCard } from './copilot/AnswerCard';
import { WeekBlock } from './copilot/WeekBlock';
import { PastQuestionsList, PastQuestionsRow, usePastQuestions } from './copilot/PastQuestions';
import { copilotAnswerKey } from './copilot/copilotErasure';
import { useCopilotAsk, type CopilotTurn } from './copilot/useCopilotAsk';
import { ledger } from './copilot/ledger';

export const COPILOT_RECENT_KEY = ['copilot', 'recent'] as const;
type Params = { view?: 'questions' | 'answer'; item?: PastQuestion };
type Nav = NativeStackNavigationProp<ParamListBase>;

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
  const needsCoach = useClientNeedsCoach();
  const p = useRoute<RouteProp<Record<string, Params | undefined>, string>>().params ?? {};
  if (needsCoach) return <CoachLock />;
  if (p.view === 'questions') return <QuestionsView />;
  if (p.view === 'answer' && p.item) return <AnswerView item={p.item} />;
  return <PathView />;
}

/** The forest masthead: back, the serif title, then the week block or a chip. */
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
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const coach = useCoachFirstName();
  const needsCoach = useClientNeedsCoach();
  const q = useQuery({ queryKey: COPILOT_RECENT_KEY, queryFn: () => copilotApi.recent(), enabled: !needsCoach });
  const past = usePastQuestions();
  const { turns, busy, ask, erased } = useCopilotAsk();
  const [draft, setDraft] = useState('');
  const refilled = useRef('');
  useEffect(() => { if (erased) setDraft((d) => (d === refilled.current ? '' : d)); }, [erased]);
  const refusal = q.error ? aiRefusalOf(q.error) : null;
  const week = q.data?.week ?? null;
  const items = q.data?.suggestions ?? [];
  const total = past.data?.pages[0]?.total ?? 0;
  const asked = turns.length > 0;
  const reveal = useReveal(turns);
  // The server says the same (b#1129: 403 ROMAN_REQUIRES_COACH) when the phone has not heard the coach left yet; a send can too.
  if (needsCoach || copilotErrorOf(q.error).code === 'ROMAN_REQUIRES_COACH' || turns.some((t) => t.error?.kind === 'requiresCoach')) return <CoachLock />;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['copilot'] });
  // A question with no Try again (stored, or wait / daily cap / credits out) goes back in an empty composer: asking
  // again is the client's call (main's rule).
  const onAsk = (text: string, retryId?: string) => void ask(text, retryId).then((o) => {
    if (o === 'sent') refresh();
    if (o === 'stored' || o === 'held') setDraft((d) => (d.trim() === '' ? (refilled.current = text) : d));
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
                <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]}>
                  {starters.map((label, i) => (
                    <Pressable key={label} onPress={() => onAsk(label)} disabled={busy} accessibilityRole="button" accessibilityLabel={label}
                      accessibilityState={{ disabled: busy }} testID={`copilot-starter-${i}`}
                      style={({ pressed }) => [s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: ledger.line },
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
            {total > 0 ? <PastQuestionsRow total={total} onPress={() => navigation.push('Copilot', { view: 'questions' })} /> : null}
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
  // The erased chat's turns went: back to the top of the board, and the next first question sits under the folded
  // masthead again.
  const had = useRef(0);
  if (turns.length === 0 && had.current > 0) Object.assign(m.current, { y: 0, seen: 1 });
  had.current = turns.length;
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

function Asked({ question, at, day }: { question: string; at: Date; day?: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={s.asked}>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{A.youAsked(day ? `${day}, ${timeOf(at)}` : timeOf(at))}</Text>
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
    : error.kind === 'rateLimited' ? [romanRateLimited(error.retryAfterSeconds), '', false]
    : stored ? [ROMAN_STORED_NO_REPLY, '', false]
    : error.kind === 'offline' ? [ROMAN_OFFLINE_TITLE, ROMAN_OFFLINE_BODY, true]
    : [ROMAN_ERROR_TRANSIENT, '', true];
  return (
    <View style={[s.card, s.pad, { backgroundColor: ledger.card, borderColor: ledger.line }]} accessibilityRole="alert" testID={`copilot-turn-${error.kind}`}>
      <View style={s.who}>
        <RomanAvatar crop="neutral" size={28} />
        <Text style={[typography.bodyMd, s.strong, s.grow, { color: sc.textPrimary }]}>{title}</Text>
      </View>
      {body ? <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>{body}</Text> : null}
      {retry ? <PrimaryButton label="Try again" onPress={onRetry} testID="copilot-retry" /> : null}
    </View>
  );
}

function QuestionsView() {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<Nav>();
  const q = usePastQuestions();
  const first = q.data?.pages[0] ?? null;
  const items = (q.data?.pages ?? []).flatMap((pg) => pg?.items ?? []);
  // A failed "Show older questions" says so where the link is, and its Try again reads that page again (Opus C1).
  const older = q.isFetchNextPageError;
  const failed = q.error ? (
    <QuietError message={loadFailureMessage(q.error, A.past)} onRetry={() => void (older ? q.fetchNextPage() : q.refetch())}
      retrying={older ? q.isFetchingNextPage : q.isRefetching} layout={older ? 'inline' : 'block'} testID="copilot-past-error" />
  ) : null;
  return (
    <>
      <ForestStatusBar />
      <Screen edges={['bottom']} testID="copilot-questions" contentStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={sc.textMuted} />}>
        <Mast back={C.title} title={A.past} compact>
          {first?.since ? (
            <View style={[s.chip, { backgroundColor: sc.surface.forestBand }]}>
              <Text style={[typography.bodySmall, { color: sc.textOnAccent }]}>{A.since(first.total, monthYear(first.since))}</Text>
            </View>
          ) : null}
        </Mast>
        <View style={s.body}>
          {q.isPending ? <QuietLoading label="Loading past questions" rows={4} testID="copilot-past-loading" /> : null}
          {older ? null : failed}
          <PastQuestionsList items={items} more={q.hasNextPage && !older} loadingMore={q.isFetchingNextPage}
            onMore={() => void q.fetchNextPage()} onOpen={(item) => navigation.push('Copilot', { view: 'answer', item })} />
          {older ? failed : null}
        </View>
      </Screen>
    </>
  );
}

/**
 * The answer route leaves the stack when its chat is erased (Delete or Delete all in Settings, or the
 * transcript finds it gone), so its question cannot be read again with Back (#852 round 1, B1). Only this
 * route is removed; the screen on top (Settings) stays where it is.
 */
function useLeaveWhenErased(sessionId: string) {
  const navigation = useNavigation<Nav>();
  const routeKey = useRoute().key;
  useEffect(() => {
    const leave = (id: string | null) => {
      if (id !== null && id !== sessionId) return;
      navigation.dispatch((state) => {
        const at = state.routes.findIndex((r) => r.key === routeKey);
        if (at < 0 || state.routes.length < 2) return CommonActions.goBack();
        const routes = state.routes.filter((r) => r.key !== routeKey);
        return CommonActions.reset({ ...state, routes, index: at <= state.index ? Math.max(0, state.index - 1) : state.index });
      });
    };
    const offErased = romanChatsEvents.onErased((e) => leave(e.id));
    const offGone = romanChatsEvents.onGone((e) => leave(e.id));
    return () => {
      offErased();
      offGone();
    };
  }, [navigation, routeKey, sessionId]);
}

function AnswerView({ item }: { item: PastQuestion }) {
  const coach = useCoachFirstName();
  const qc = useQueryClient();
  useLeaveWhenErased(item.sessionId);
  const q = useQuery({
    queryKey: copilotAnswerKey(item.sessionId, item.messageId),
    // null: the server no longer has it (chat deleted elsewhere, 404). It replaces any answer read before,
    // so a deleted answer is never drawn from the cache.
    queryFn: async () => {
      try {
        return await copilotApi.answer(item.sessionId, item.messageId);
      } catch (err) {
        if (copilotErrorOf(err).status === 404) return null;
        throw err;
      }
    },
    meta: { persist: false },
  });
  const sug = q.data?.reply?.suggestion ?? null;
  const missing = q.isSuccess && !q.data;
  return (
    <>
      <ForestStatusBar />
      <Screen edges={['bottom']} testID="copilot-past-answer" contentStyle={s.list}>
        <Mast back={A.past} title={C.title} compact />
        <View style={[s.body, s.turn]}>
          <Asked question={item.question ?? ''} at={new Date(item.askedAt)} day={shortDay(item.askedAt)} />
          {q.isPending ? <QuietLoading label="Loading the answer" rows={3} testID="copilot-answer-loading" /> : null}
          {q.error || missing ? <QuietError message={loadFailureMessage(q.error, 'This answer')} onRetry={() => void q.refetch()} retrying={q.isRefetching} testID="copilot-answer-error" /> : null}
          {q.data ? <AnswerCard text={q.data.text} reply={q.data.reply} /> : null}
          {/* A decided change was decided by whoever coached then; only an unsent one goes to today's coach (C1). */}
          {/* Sent from here, Your path's lists and this answer read the server again (as a turn's Send does). */}
          {q.data ? (
            <SuggestionSlot suggestion={sug} coach={sug?.status === 'suggested' ? coach : C.yourCoach} onSent={() => void qc.invalidateQueries({ queryKey: ['copilot'] })} />
          ) : null}
        </View>
      </Screen>
    </>
  );
}

const s = StyleSheet.create({
  flagOff: { flex: 1, justifyContent: 'center' },
  page: { paddingHorizontal: 0, paddingBottom: 0 },
  list: { paddingHorizontal: 0 },
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
  chip: { alignSelf: 'flex-start', borderRadius: radius.button, paddingHorizontal: 10, paddingVertical: 4 },
});
