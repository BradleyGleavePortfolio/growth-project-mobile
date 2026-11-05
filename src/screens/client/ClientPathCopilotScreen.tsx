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
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { AccessibilityInfo, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute, type ParamListBase, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forestPop, layout, pathTint, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import EmptyState from '../../components/EmptyState';
import { AI_REFUSAL_ACTIONS } from '../../components/ai/AiRefusalNotice';
import CopilotComposer from '../../components/copilot/CopilotComposer';
import RomanAvatar from '../../components/roman/RomanAvatar';
import RomanTypingIndicator from '../../components/roman/RomanTypingIndicator';
import {
  ROMAN_AI_ON_ASK_AGAIN, ROMAN_ERROR_TRANSIENT, ROMAN_OFFLINE_BODY, ROMAN_OFFLINE_TITLE, ROMAN_QUICK_STARTS, ROMAN_ROOM_FOOTER,
  ROMAN_STORED_NO_REPLY, romanPoolEmpty, romanRateLimited,
} from '../../components/roman/romanVoice';
import { ForestStatusBar } from '../../components/StatusBarBand';
import { Headline, Screen, TextLink, useScreenInsets } from '../../ui';
import { HapticService } from '../../ui/haptics/haptics.service';
import { loadFailureMessage } from '../../ui/states/QuietStates';
import { aiRefusalOf } from '../../lib/ai/aiRefusal';
import { AI_DAILY_CAP_TITLE, aiDailyCapBody } from '../../lib/ai/aiDailyCap';
import { featureFlags } from '../../config/featureFlags';
import { useMyCoaches } from '../../hooks/useCalendar';
import { JOIN_A_COACH, ROMAN_LOCK_BODY, ROMAN_LOCK_TITLE, useClientNeedsCoach } from '../../components/coachless/JoinCoachState';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { useOpenSupport } from '../../components/ai/useOpenSupport';
import { COMMUNITY_REPORT_CRISIS_LINE } from '../../api/communitySafetyApi';
import type { RomanApiError } from '../../api/romanApi';
import { copilotApi, copilotErrorOf, type CopilotSuggestion, type PastQuestion } from '../../api/copilotApi';
import { romanChatsEvents } from '../settings/romanChatsEvents';
import { COPILOT_COPY as C, shortDay } from './copilot/pathChangeWords';
import { ASK_COPY as A, monthYear, targetChangedOn, timeOf, withoutCites } from './copilot/askWords';
import { SuggestionStatusList } from './copilot/SuggestionStatusList';
import { SuggestionCard } from './copilot/SuggestionCard';
import { AnswerCard } from './copilot/AnswerCard';
import { WeekBlock } from './copilot/WeekBlock';
import { LedgerRetry, PastQuestionsList, PastQuestionsRow, usePastQuestions } from './copilot/PastQuestions';
import { copilotAnswerKey } from './copilot/copilotErasure';
import { useCopilotAsk, type CopilotTurn } from './copilot/useCopilotAsk';
import { ledger, ledgerGutter, ledgerType } from './copilot/ledger';
import { CalmIn, CopilotRefusal, LedgerButton, RomanNotice } from './copilot/RomanNotice';

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

/**
 * Roman's lock for a client with no coach, drawn as style A frame 12 (Opus B-878R2-G3, Sol B-R2-FALLBACK): Back to
 * You, Roman at 72, today's lock words (JoinCoachState) with the line in the ledger's #5A5A56, and "Join a coach" (the
 * same EntitlementProvider.messageCoach join) under the text, not in a footer. The crisis line and Contact support stay
 * under it (b#900: never only a join wall).
 */
function CoachLock() {
  const navigation = useNavigation();
  const { messageCoach } = useEntitlement();
  const openSupport = useOpenSupport();
  const id = 'copilot-coach-lock';
  const back = (
    <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={`Back to ${C.back}`} style={[s.back, s.lockBack]} testID={`${id}-back`}>
      <Ionicons name="chevron-back" size={22} color={forestPop.forest} />
      <Text style={[ledgerType.nav, { color: forestPop.forest }]}>{C.back}</Text>
    </Pressable>
  );
  return (
    <Screen header={back} centerContent contentStyle={s.lock} testID={id}>
      <RomanAvatar crop="neutral" size={72} testID={`${id}-roman`} />
      <Headline style={s.lockTitle} testID={`${id}-title`}>{ROMAN_LOCK_TITLE}</Headline>
      <Text style={[s.lockBody, { color: ledger.muted }]} testID={`${id}-body`}>{ROMAN_LOCK_BODY}</Text>
      <LedgerButton label={JOIN_A_COACH} onPress={messageCoach} style={s.lockJoin} testID={`${id}-join`} />
      <Text style={[s.lockHelp, { color: ledger.muted }]} testID={`${id}-crisis`}>{COMMUNITY_REPORT_CRISIS_LINE}</Text>
      {openSupport ? <TextLink label={AI_REFUSAL_ACTIONS.contactSupport} onPress={() => void openSupport()} size="small" align="start" tone="accent" testID={`${id}-support`} /> : null}
    </Screen>
  );
}

/**
 * A Copilot read on its way: the ledger's own placeholder, a white card with cool grey bars, not the app's warm cream
 * skeleton (Sol B-R2-FALLBACK). Screen readers hear `label`; under Reduce Motion the bars hold still.
 */
function LedgerLoading({ label, rows, testID }: { label: string; rows: number; testID: string }) {
  // The Skeleton's Reduce Motion rule on the ledger's palette: a gentle 0.7 to 1 pulse over 1.5 s once the probe says
  // motion is fine (or the probe fails), a steady 0.7 when Reduce Motion is on.
  const [still, setStill] = useState<boolean | null>(null);
  const pulse = useSharedValue(0.7);
  useEffect(() => {
    let live = true;
    // Only a plain "no" from the probe starts the pulse; a probe that throws keeps motion on, as the Skeleton does.
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.()).then((on) => { if (live) setStill(on !== false); }, () => { if (live) setStill(false); });
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (on) => { if (live) setStill(on); });
    return () => { live = false; sub?.remove(); };
  }, []);
  useEffect(() => {
    if (still === null) return;
    pulse.value = still ? 0.7 : withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [pulse, still]);
  const fade = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View accessible accessibilityLabel={label} testID={testID}
      style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={[s.bones, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: ledger.line }, fade]}
          testID={`${testID}-row`}>
          <View style={[s.bone, s.boneLong, { backgroundColor: ledger.line }]} testID={`${testID}-bar`} />
          <View style={[s.bone, s.boneShort, { backgroundColor: ledger.line }]} testID={`${testID}-bar`} />
        </Animated.View>
      ))}
    </View>
  );
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
  const g = useGutter();
  const light = { color: sc.textOnAccent };
  return (
    <View style={[s.mast, compact && s.mastSmall, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + 12, paddingHorizontal: g }]} testID="copilot-mast">
      <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={`Back to ${back}`} style={s.back} testID="copilot-back">
        <Ionicons name="chevron-back" size={22} color={ledger.nav} />
        <Text style={[ledgerType.nav, { color: ledger.nav }]}>{back}</Text>
      </Pressable>
      <Text style={[compact ? ledgerType.mastSmall : [ledgerType.mast, s.mastTitle], light]} accessibilityRole="header" testID="copilot-mast-title">{title}</Text>
      {children}
    </View>
  );
}

/** Style A's gutter (--g) for this screen's masthead and body: 16 on a phone under 375 wide (Opus B-878-G2). */
function useGutter() {
  return ledgerGutter(useWindowDimensions().width);
}

function PathView() {
  const { semanticColors: sc } = useTheme();
  const g = useGutter();
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const coach = useCoachFirstName();
  const needsCoach = useClientNeedsCoach();
  const q = useQuery({ queryKey: COPILOT_RECENT_KEY, queryFn: () => copilotApi.recent(), enabled: !needsCoach });
  const past = usePastQuestions();
  const { turns, busy, ask, erased } = useCopilotAsk();
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
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
  // A change still shown under its answer (its card, or its status) is not listed a second time below. Once it is sent
  // from that card the card keeps only "Sent", so its status shows here, then Approved or Not approved (Sol B-R2-SEND).
  const underAnswers = new Set(turns.map((t) => t.answer?.reply?.suggestion?.id).filter((id) => id && !sent.has(id)));
  // After an answer, the starters not asked yet stay as quick chips under the last turn (frame 03, Opus B-G1); none
  // while Roman answers, and none while AI help is off, credits are out or the daily cap holds (frames 07, 08, 09).
  const last = turns[turns.length - 1];
  // None under any turn that ended in a failure card (offline, rate limit, stored, the limits) or a crisis reply
  // either (Opus B-878-G3): the card's own action is the only next step there.
  // None under a proposal either (frames 04, 05; Sol B-878-G): the change, then its Sent line and status, is the turn.
  const more = asked && !busy && !last?.error && !last?.answer?.safety?.length && !last?.answer?.reply?.suggestion
    ? starters.filter((q) => !turns.some((t) => t.question === q)) : [];
  const listed = items.filter((i) => !underAnswers.has(i.id));
  const composer = (
    <CopilotComposer value={draft} onChangeText={setDraft} sending={busy} gutter={g} testID="copilot-composer"
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
          <View style={[s.body, { paddingHorizontal: g, paddingTop: asked ? 18 : 22 }]} onLayout={(e) => reveal.body(e.nativeEvent.layout.y)} testID="copilot-body">
            {q.isPending ? <LedgerLoading label="Loading your path" rows={2} testID="copilot-loading" /> : null}
            {refusal ? <CopilotRefusal refusal={refusal} onRetry={() => void q.refetch()} testID="copilot-load-refusal" /> : null}
            {/* A failed re-read over what is on screen keeps it there; the card is for a first read that failed (C-852R3-1). */}
            {q.error && !refusal && !q.data ? (
              <LedgerRetry message={loadFailureMessage(q.error, 'Your path')} onRetry={() => void q.refetch()} retrying={q.isRefetching} testID="copilot-error" />
            ) : null}
            {turns.map((t, i) => (
              <View key={t.id} onLayout={(e) => reveal.turn(i, e.nativeEvent.layout.y)}>
                <Turn turn={t} coach={coach} onRetry={() => onAsk(t.question, t.id)} onSent={(sid) => { setSent((p) => new Set(p).add(sid)); refresh(); }}
                  folded={i === turns.length - 1 && sent.has(t.answer?.reply?.suggestion?.id ?? '')} />
              </View>
            ))}
            {asked ? null : (
              <View style={s.section} testID="copilot-ask">
                <Text style={[ledgerType.section, { color: sc.textPrimary }]} accessibilityRole="header">{A.askHeading}</Text>
                <View style={[s.card, { backgroundColor: ledger.card, borderColor: ledger.line }]}>
                  {starters.map((label, i) => (
                    <Pressable key={label} onPress={() => { void HapticService.selection(); onAsk(label); }} disabled={busy} accessibilityRole="button" accessibilityLabel={label}
                      accessibilityState={{ disabled: busy }} testID={`copilot-starter-${i}`}
                      style={({ pressed }) => [s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: ledger.line },
                        (pressed || label === A.whyCalories) && { backgroundColor: pathTint.leaf }]}>
                      <Text style={[ledgerType.ask, s.grow, { color: sc.textPrimary }, label === A.whyCalories && s.strong]}>{label}</Text>
                      <Ionicons name="chevron-forward" size={18} color={forestPop.moss} testID={`copilot-starter-${i}-chevron`} />
                    </Pressable>
                  ))}
                </View>
                <Text style={[ledgerType.privacy, s.hint, { color: ledger.muted }]} testID="copilot-hint">{A.hint(coach)}</Text>
              </View>
            )}
            {more.length > 0 ? (
              <View style={s.chips} testID="copilot-more">
                {more.map((label, i) => (
                  <Pressable key={label} onPress={() => { void HapticService.selection(); onAsk(label); }} accessibilityRole="button" accessibilityLabel={label} testID={`copilot-more-${i}`}
                    style={({ pressed }) => [s.more, { backgroundColor: pressed ? pathTint.leaf : ledger.card, borderColor: ledger.chip }]}>
                    <Text style={[ledgerType.chip, { color: forestPop.forest, flexShrink: 1 }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {listed.length > 0 ? <SuggestionStatusList items={listed} coach={coach} /> : null}
            {total > 0 ? <PastQuestionsRow total={total} onPress={() => navigation.push('Copilot', { view: 'questions' })} /> : null}
            <Text style={[ledgerType.foot, s.footer, { color: ledger.muted }]} testID="copilot-footer">{ROMAN_ROOM_FOOTER}</Text>
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
      <Text style={[ledgerType.who, { color: ledger.muted }]}>{A.youAsked(day ? `${day}, ${timeOf(at)}` : timeOf(at))}</Text>
      <Text style={[ledgerType.question, { color: sc.textPrimary }]} accessibilityRole="header" testID="copilot-asked">{question}</Text>
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

/**
 * One question and Roman's answer. Once its change is sent from the newest turn, that turn folds to the question and
 * its Sent line (frame 05, Sol B-878-G); the status follows under Suggestions, and the answer stays in Past questions
 * and comes back here once another question is asked. A new answer fades in (CalmIn).
 */
function Turn({ turn, coach, onRetry, onSent, folded = false }: {
  turn: CopilotTurn; coach: string; onRetry: () => void; onSent: (id: string) => void; folded?: boolean;
}) {
  const a = turn.answer;
  const [dismissed, setDismissed] = useState(false);
  // The answer is read out when it arrives, as the error card is (accessibilityRole alert).
  useEffect(() => { if (a) AccessibilityInfo.announceForAccessibility(withoutCites(a.text)); }, [a]);
  return (
    <View style={s.turn} testID="copilot-turn">
      <Asked question={turn.question} at={turn.askedAt} />
      {a && !folded ? <CalmIn><AnswerCard text={a.text} reply={a.reply} safety={a.safety} compact={!!a.reply?.suggestion} /></CalmIn> : null}
      {a && !dismissed ? (
        <SuggestionSlot suggestion={a.reply?.suggestion ?? null} coach={coach} onSent={() => a.reply?.suggestion && onSent(a.reply.suggestion.id)} onDismiss={() => setDismissed(true)} />
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
  const [granted, setGranted] = useState(false);
  const stored = error.turnStored === true;
  if (error.kind === 'aiRefused' && error.refusal && !granted) {
    return <CopilotRefusal refusal={error.refusal} onRetry={stored ? () => setGranted(true) : onRetry} testID="copilot-ai-refusal" />;
  }
  // Style A draws the daily cap inline with main's words (frame 09, CP-A-40), not main's pop-up (style B, CP-B-23).
  const [title, body, retry]: [string, string, boolean] =
    error.kind === 'dailyCap' ? [AI_DAILY_CAP_TITLE, error.dailyCap ? aiDailyCapBody(error.dailyCap, 'client') : '', false]
    : error.kind === 'poolEmpty' ? ['', romanPoolEmpty('client'), false]
    : granted ? [ROMAN_AI_ON_ASK_AGAIN, '', false]
    : error.kind === 'rateLimited' ? [romanRateLimited(error.retryAfterSeconds), '', false]
    : stored ? [ROMAN_STORED_NO_REPLY, '', false]
    : error.kind === 'offline' ? [ROMAN_OFFLINE_TITLE, ROMAN_OFFLINE_BODY, true]
    : [ROMAN_ERROR_TRANSIENT, '', true];
  return (
    <RomanNotice title={title || undefined} body={body || undefined} testID={`copilot-turn-${error.kind}`}>
      {retry ? <LedgerButton label="Try again" onPress={onRetry} testID="copilot-retry" /> : null}
    </RomanNotice>
  );
}

function QuestionsView() {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<Nav>();
  const q = usePastQuestions();
  const g = useGutter();
  const first = q.data?.pages[0] ?? null;
  const items = (q.data?.pages ?? []).flatMap((pg) => pg?.items ?? []);
  // A failed "Show older questions" says so where the link is, and its Try again reads that page again (Opus C1).
  const older = q.isFetchNextPageError;
  // A failed re-read over loaded pages keeps them, with no card (C-852R3-1).
  const failed = q.error && (older || !q.data) ? (
    <LedgerRetry message={loadFailureMessage(q.error, A.past)} onRetry={() => void (older ? q.fetchNextPage() : q.refetch())}
      retrying={older ? q.isFetchingNextPage : q.isRefetching} testID="copilot-past-error" />
  ) : null;
  return (
    <>
      <ForestStatusBar />
      <Screen edges={['bottom']} testID="copilot-questions" contentStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={sc.textMuted} />}>
        <Mast back={C.title} title={A.past} compact>
          {first?.since ? (
            <View style={s.mini} testID="copilot-past-since">
              <Text style={[ledgerType.mini, { color: sc.textOnAccent }]}>{A.since(first.total, monthYear(first.since))}</Text>
            </View>
          ) : null}
        </Mast>
        <View style={[s.body, s.histBody, { paddingHorizontal: g }]}>
          {q.isPending ? <LedgerLoading label="Loading past questions" rows={4} testID="copilot-past-loading" /> : null}
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
  const g = useGutter();
  return (
    <>
      <ForestStatusBar />
      <Screen edges={['bottom']} testID="copilot-past-answer" contentStyle={s.list}>
        <Mast back={A.past} title={C.title} compact />
        <View style={[s.body, s.turn, { paddingHorizontal: g, paddingTop: 18 }]}>
          <Asked question={item.question ?? ''} at={new Date(item.askedAt)} day={shortDay(item.askedAt)} />
          {q.isPending ? <LedgerLoading label="Loading the answer" rows={3} testID="copilot-answer-loading" /> : null}
          {(q.error && !q.data) || missing ? <LedgerRetry message={loadFailureMessage(q.error, 'This answer')} onRetry={() => void q.refetch()} retrying={q.isRefetching} testID="copilot-answer-error" /> : null}
          {/* Folded under a change as a turn's answer is (Sol B-G3): the change, not the facts, is the next step. */}
          {q.data ? <CalmIn><AnswerCard text={q.data.text} reply={q.data.reply} compact={!!sug} /></CalmIn> : null}
          {/* A decided change was decided by whoever coached then; only an unsent one goes to today's coach (C1). */}
          {/* Sent from here, Your path's lists and this answer read the server again (as a turn's Send does). */}
          {q.data ? (
            <SuggestionSlot suggestion={sug} coach={sug?.status === 'suggested' ? coach : C.yourCoach} onSent={() => void qc.invalidateQueries({ queryKey: ['copilot'] })} />
          ) : null}
          {/* The room's line under a saved answer too (Sol B-S2): it is still Roman's guidance. */}
          {q.data ? <Text style={[ledgerType.foot, s.footer, s.savedFoot, { color: ledger.muted }]} testID="copilot-answer-footer">{ROMAN_ROOM_FOOTER}</Text> : null}
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
  // Style A's masthead (.mh, .nav, .mh h1; Sol B-878-G): Back 44 tall, the title 4 under it, 20 under the week.
  mast: { paddingHorizontal: 20, paddingBottom: 20, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  mastTitle: { marginTop: 4, letterSpacing: 0.2 },
  // Style A compact masthead (.mhs, .nav, .mhs .mini span; #852 round 3 B-H1): the title right under Back.
  mastSmall: { paddingBottom: 14 },
  histBody: { paddingTop: 18 },
  back: { minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  mini: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)' },
  body: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  section: { gap: 10 },
  // .trust 12 under the card (the section's gap is 10).
  hint: { marginTop: 2 },
  turn: { gap: 12 },
  asked: { gap: 3 },
  strong: { fontWeight: '600' },
  grow: { flex: 1 },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: 'hidden' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  // .chips 14 under the answer (the page's gap is 16).
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -2 },
  more: { maxWidth: '100%', minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: radius.button, paddingHorizontal: 14, paddingVertical: 8 },
  footer: { textAlign: 'center', paddingTop: 0, paddingBottom: 2 },
  savedFoot: { marginTop: 4 },
  bones: { minHeight: 52, justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  bone: { height: 12, borderRadius: 6 },
  boneLong: { width: '72%' },
  boneShort: { width: '44%', height: 10 },
  // Style A frame 12 (.lockp): Roman, the serif headline 32, the line 16/1.5, the button 24 under it.
  lockBack: { marginLeft: layout.gutter - 4, marginTop: 4 },
  lock: { paddingHorizontal: 28, alignItems: 'flex-start' },
  lockTitle: { fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', fontSize: 32, lineHeight: 40, letterSpacing: 0, marginTop: 20 },
  lockBody: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, marginTop: 10 },
  lockJoin: { alignSelf: 'stretch', marginTop: 24 },
  lockHelp: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginTop: 20 },
});
