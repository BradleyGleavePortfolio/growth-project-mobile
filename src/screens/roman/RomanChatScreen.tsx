/**
 * RomanChatScreen — the Roman Phase 1 chat surface (client + coach).
 *
 * One screen serves both ROMAN_SURFACES (roman.dto.ts L18). The host surface is
 * passed as a route param (`surface`) — ClientNavigator passes 'client',
 * CoachNavigator passes 'coach' — so there is no client-side role-guessing and
 * the value is always one the backend @IsIn(ROMAN_SURFACES) accepts.
 *
 * FACE+VOICE (operator rule, P0): Roman's face renders with every Roman-voiced
 * string — the header carries his avatar, the empty state (RomanGreeting), each
 * assistant bubble, the typing indicator, and every typed state. No new
 * client-side Roman prose exists beyond romanVoice.ts, which is sourced from the
 * identity spec (cited there per string).
 *
 * Typed states (brief §3): loading skeleton, "Roman unavailable" (404 flag-off
 * — calm, no retry loop), offline, generic error, send-failure (message stays
 * in the composer for retry), rate-limited (calm backoff copy), and the daily
 * AI cap pop-up (AiDailyCapModal, owner words + local reset time).
 *
 * Emotional target (DESIGN_INTELLIGENCE §5.1): the user leaves feeling attended
 * to and in capable hands. Primary path (Hick's Law §4.4): a single composer +
 * send — no competing actions on the surface.
 *
 * B30 (owner 14:57, "a luxurious AI chat room, the UI and class of a premium
 * Anthropic mixed with iMessage"; prototype 69-73): serif "Roman" title with
 * its overline, a launch state with Roman's whole portrait and one line, four
 * quick-start chips that send fixed prompts, Roman's replies as serif reading
 * text that fades in paragraph by paragraph (Reduce Motion: at once), the
 * client's turns as quiet bubbles, and the composer with the forest send
 * square in the src/ui Screen footer, above the keyboard and the gesture bar.
 *
 * Owner 2026-10-09 00:0x: a client with no coach, or a 403 ROMAN_REQUIRES_COACH,
 * gets the "Join a coach" lock instead of the room. Nothing is sent to Roman.
 */
import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { useChatDraft } from '../../lib/chatDrafts';
import * as Clipboard from 'expo-clipboard';
import { generateIdempotencyKey } from '../../utils/idempotency';
import {
  AccessibilityInfo,
  Alert,
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Headline, Overline, Screen, ScreenTopBar } from '../../ui';
import RomanQuickStarts from '../../components/roman/RomanQuickStarts';
import RomanAvatar from '../../components/roman/RomanAvatar';
import RomanGreeting from '../../components/roman/RomanGreeting';
import RomanMessageBubble from '../../components/roman/RomanMessageBubble';
import RomanTypingIndicator from '../../components/roman/RomanTypingIndicator';
import RomanComposer from '../../components/roman/RomanComposer';
import RomanState from '../../components/roman/RomanState';
import AiRefusalNotice from '../../components/ai/AiRefusalNotice';
import AiDailyCapModal from '../../components/ai/AiDailyCapModal';
import RomanConsentGate from '../../components/roman/RomanConsentGate';
import RomanLoadingSkeleton from '../../components/roman/RomanLoadingSkeleton';
import { aiRefusalCopy } from '../../lib/ai/aiRefusal';
import { useRomanReveal } from '../../components/roman/useRomanReveal';
import RomanHeldCard from '../../components/roman/RomanHeldCard';
import {
  romanPoolEmpty,
  romanRateLimited,
  ROMAN_LOADING_OLDER,
  ROMAN_REPLY_ANNOUNCE_PREFIX,
  ROMAN_HELD_NOT_SENT,
  ROMAN_HELD_NO_ANSWER,
  ROMAN_HELD_NOT_READY,
  ROMAN_AI_ON_ASK_AGAIN,
  ROMAN_ROOM_FOOTER,
  romanRoomOverline,
} from '../../components/roman/romanVoice';
import { useRomanChat } from './useRomanChat';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachlessClient } from '../../hooks/useCoachlessClient';
import { logger } from '../../utils/logger';
import { authEpoch, onAuthEpochChange } from '../../services/accountBinding';
import { reportMessage, type RomanMessage, type RomanSurface } from '../../api/romanApi';
import type { ReportReason } from '../../api/messagesApi';
import MessageActionSheet from '../../components/messaging/MessageActionSheet';
import ReportMessageSheet from '../../components/messaging/ReportMessageSheet';
import ReplyComposer from '../../components/messaging/ReplyComposer';
import { isLocalRomanId, romanQuoteExcerpt, splitRomanQuote, withRomanQuote } from '../../components/roman/romanReply';
import { spacing, typography } from '../../theme/tokens';
import RomanConversationsButton from '../../components/roman/RomanConversationsButton';
import JoinCoachState, { ROMAN_LOCK_BODY, ROMAN_LOCK_TITLE, useClientNeedsCoach } from '../../components/coachless/JoinCoachState';
import { useTheme } from '../../theme/useTheme';
import { featureFlags } from '../../config/featureFlags';
import CreditPoolEmptyLinks from '../../components/coach/credits/CreditPoolEmptyLinks';

export interface RomanChatScreenProps {
  /** Host surface; defaults to 'client' when a route omits it. */
  surface?: RomanSurface;
}

/** Roman's locked state for a client with no coach (Back keeps the stack). */
function RomanCoachLock(): React.ReactElement {
  const navigation = useContext(NavigationContext);
  return (
    <JoinCoachState
      roman
      title={ROMAN_LOCK_TITLE}
      body={ROMAN_LOCK_BODY}
      onBack={navigation ? () => navigation.goBack() : undefined}
      testID="roman-coach-lock"
    />
  );
}

export default function RomanChatScreen({
  surface = 'client',
}: RomanChatScreenProps): React.ReactElement {
  const needsCoach = useClientNeedsCoach();
  // Checked before the room mounts, so no session is opened for them.
  if (surface === 'client' && needsCoach) return <RomanCoachLock />;
  // COACH-AI-CONSENT: the coach room opens only while the coach's own Roman is on.
  if (surface === 'coach') {
    return (
      <RomanConsentGate surface="coach">
        <RomanChatRoom surface="coach" />
      </RomanConsentGate>
    );
  }
  return <RomanChatRoom surface={surface} />;
}

/** The chat a selection belongs to: this sign-in (auth epoch) and the open session. */
function useChatKey(sessionId: string | null): string {
  const [epoch, setEpoch] = useState(authEpoch);
  useEffect(() => onAuthEpochChange(setEpoch), []);
  return `${epoch}:${sessionId ?? ''}`;
}

type ChatBoundSet = (next: RomanMessage | null | ((cur: RomanMessage | null) => RomanMessage | null)) => void;

/**
 * A Roman reply picked in one chat (KT-13, FIX-950R1). It reads as null the moment the chat
 * changes (no frame where an erased reply is still drawn or sent) and is then let go. The setter
 * is stable and always files a pick under the chat open now, so a memoised hold handler works
 * in every chat, and a late clear from an older send can only drop the reply it sent.
 */
function useChatBound(chat: string): [RomanMessage | null, ChatBoundSet] {
  const [held, setHeld] = useState<{ chat: string; m: RomanMessage } | null>(null);
  const chatRef = useRef(chat);
  useEffect(() => {
    chatRef.current = chat;
    setHeld((h) => (h && h.chat !== chat ? null : h));
  }, [chat]);
  const set = useCallback<ChatBoundSet>(
    (next) =>
      setHeld((h) => {
        const now = chatRef.current;
        const cur = h && h.chat === now ? h.m : null;
        const m = typeof next === 'function' ? next(cur) : next;
        return m ? { chat: now, m } : null;
      }),
    [],
  );
  return [held && held.chat === chat ? held.m : null, set];
}

function RomanChatRoom({ surface }: { surface: RomanSurface }): React.ReactElement {
  const navigation = useContext(NavigationContext);
  const { semanticColors: sc } = useTheme();
  const user = useCurrentUser();
  const coachless = useCoachlessClient();
  const {
    phase,
    session,
    isFirstOpen,
    messages,
    sending,
    sendError,
    nextCursor,
    loadingOlder,
    reload,
    loadOlder,
    send,
    clearSendError,
  } = useRomanChat(surface);
  // CHAT-DISCARD (owner 10-21): half-typed text stays with this chat on the device (src/lib/chatDrafts.ts).
  const [draft, setDraft, { keyFor, keepFailed, keptSend, keepAside, dropFailed }] = useChatDraft('roman');
  // Shown after AI help is allowed for a message the server already stored.
  const [askAgainHint, setAskAgainHint] = useState(false);
  // The quick-start chip last sent (forest outline, prototype 70).
  const [pickedChip, setPickedChip] = useState<string | null>(null);
  // OS "Reduce Motion" preference. When ON, the auto-scroll to the newest turn
  // is instant rather than animated, matching the reduced-motion parity the
  // typing indicator already honours (R3 P2-1). Defaults to motion-on so a
  // failed probe never strands the latest message off-screen.
  const [reduceMotion, setReduceMotion] = useState(false);
  // ROMAN-HOLD-M (#197-D3): the held reply (menu open), the reply being
  // answered (quote strip over the composer) and the reply being reported.
  // KT-13 (FIX-950R1): each belongs to the chat and sign-in it was picked in, so an
  // erase, Delete all, a fresh or another chat, or a sign-out drops it at once.
  const chat = useChatKey(session?.id ?? null);
  const [actionTarget, setActionTarget] = useChatBound(chat);
  const [replyTarget, setReplyTarget] = useChatBound(chat);
  const [reportTarget, setReportTarget] = useChatBound(chat);
  // The chat open now, for a report that settles after the chat it was sent from is gone (FIX-950R2).
  const chatNow = useRef(chat);
  useLayoutEffect(() => {
    chatNow.current = chat;
  }, [chat]);

  // QUOTE-KEY-REOPEN-M: a quoted send whose key is kept (still out, or "not ready yet") keeps its quote with that key
  // (lib/chatDrafts), so after Back, a reopen or a restart the strip comes back over the same words, and Send rebuilds
  // the exact words the key was filed under. Only in the session it was picked in (R2: another drops the quote, the key
  // stays), and only while the box rebuilds those words byte for byte; otherwise nothing is drawn, as before. Runs once
  // the session's chat key is known: useChatBound (above, so its effect runs first) drops a pick filed before it.
  // Never after a sign-out, sign-in or re-bootstrap while the room is open (KT-13: the pick's sign-in is gone).
  const sessionId = session?.id ?? null;
  const openEpoch = useRef(authEpoch());
  useEffect(() => {
    const kept = keptSend();
    const q = kept?.quote;
    // The client room only (canHold), its session open, no strip up, a quote kept, the sign-in it opened under.
    if (surface !== 'client' || !sessionId || replyTarget || !kept || !q) return;
    if (authEpoch() !== openEpoch.current) return;
    if (q.session !== sessionId) {
      keepFailed(kept.text, kept.key);
      return;
    }
    if (withRomanQuote(q.excerpt, draft).trim() !== kept.text) return;
    setReplyTarget({ id: q.id, role: 'assistant', content: q.excerpt, interrupted: false, createdAt: '' });
  }, [chat, sessionId, draft, replyTarget, surface, keptSend, keepFailed, setReplyTarget]);
  // R3: Cancel reply, or another reply picked, drops the kept quote (not the key), so a reopen never brings it back.
  const dropKeptQuote = useCallback((unless?: string) => {
    const kept = keptSend();
    if (kept?.quote && kept.quote.id !== unless) keepFailed(kept.text, kept.key);
  }, [keptSend, keepFailed]);

  const listRef = useRef<FlatList<RomanMessage>>(null);
  // Last assistant message id we announced to assistive tech, so a re-render
  // does not re-announce the same reply (U4).
  const lastAnnouncedId = useRef<string | null>(null);
  // Last send-error message we announced, so a re-render does not re-announce
  // the same failure (R3 P1-2).
  const lastAnnouncedError = useRef<string | null>(null);
  // ROMAN-RETRY-B-M: the empty room's scroll, drawn only while Roman's card sits under the greeting.
  const emptyScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch((err) => {
        // Default to motion-on when the probe fails; the auto-scroll is purely
        // a comfort animation so a failed query never blocks reaching the
        // newest turn. Log the failed platform probe so it stays observable
        // (Bradley #36 — no silently swallowed catch).
        logger.warn('RomanChatScreen.reduceMotionQuery', err);
      });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        if (mounted) setReduceMotion(enabled);
      },
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const scrollToLatest = useCallback(() => {
    // Guard: scrollToEnd is a no-op (and warns) on an empty list.
    if (messages.length === 0) return;
    listRef.current?.scrollToEnd({ animated: !reduceMotion });
  }, [messages.length, reduceMotion]);

  // Scroll to the newest turn whenever the thread grows (send + receive), and
  // when the keyboard opens, so the latest message is never stranded (U3).
  useEffect(() => {
    scrollToLatest();
  }, [messages.length, sending, scrollToLatest]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', scrollToLatest);
    return () => show.remove();
  }, [scrollToLatest]);

  // Announce a freshly arrived Roman reply for screen-reader users, deduped by
  // message id so the same reply is announced at most once (U4).
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      if (m.id !== lastAnnouncedId.current) {
        lastAnnouncedId.current = m.id;
        AccessibilityInfo.announceForAccessibility(
          `${ROMAN_REPLY_ANNOUNCE_PREFIX}${m.content}`,
        );
      }
      break;
    }
  }, [messages]);

  const isEmpty = messages.length === 0;
  // R2b: a consent / egress refusal gets its own notice with a working action
  // (Allow AI help, or Contact support with the reference), never the
  // generic send-failed row.
  const refusal = sendError?.kind === 'aiRefused' ? (sendError.refusal ?? null) : null;
  // COACH-AI-CONSENT: coach_consent_required is CAC-5 in this notice; the room and draft stay (onRefusalRetry).
  const refusalAudience = surface === 'coach' ? 'coach' : 'client';
  // Daily AI cap: the pop-up carries the copy, so no inline error row. The
  // draft (or the stored turn) stays; the composer is never blocked, so a
  // crisis message, which the server never caps, still goes through.
  const dailyCap = sendError?.kind === 'dailyCap' ? (sendError.dailyCap ?? null) : null;
  const sendErrorCopy =
    sendError == null || dailyCap
      ? null
      : refusal
        ? (() => {
            const c = aiRefusalCopy(refusal, refusalAudience, 'roman');
            return `${c.title}. ${c.body}`;
          })()
        : sendError.kind === 'poolEmpty'
          ? romanPoolEmpty(refusalAudience)
          : sendError.kind === 'rateLimited'
            ? romanRateLimited(sendError.retryAfterSeconds)
            : sendError.turnStored
              ? (sendError.replyPending ? ROMAN_HELD_NOT_READY : ROMAN_HELD_NO_ANSWER)
              : ROMAN_HELD_NOT_SENT;

  // Announce a send failure (and its remedy) to assistive tech the moment it
  // appears. The optimistic user turn was rolled back in useRomanChat, so the
  // visible thread silently loses the message — the inline error row also
  // carries accessibilityLiveRegion="assertive", and this explicit announce is
  // the belt-and-braces guarantee on platforms that under-announce live
  // regions. Deduped by copy so a re-render does not repeat it (R3 P1-2).
  useEffect(() => {
    if (sendErrorCopy == null) {
      lastAnnouncedError.current = null;
      return;
    }
    if (sendErrorCopy !== lastAnnouncedError.current) {
      lastAnnouncedError.current = sendErrorCopy;
      AccessibilityInfo.announceForAccessibility(sendErrorCopy);
    }
  }, [sendErrorCopy]);

  const sendText = useCallback(
    async (text: string, fromChip: boolean) => {
      setAskAgainHint(false);
      // A typed reply carries its quote; a chip never does (chips hide while replying).
      const quoted = !fromChip && replyTarget ? replyTarget : null;
      // SEND-ONCE-PHONE (b#1228): the draft's send-once key; Send again with the same words after a failure that
      // keeps it (lib/sendOnce.ts) replays it, so the server answers from what the first send stored.
      // LO-963R1 N7: the key belongs to the exact words sent, quote included (m#953, lib/sendOnce.ts).
      const body = quoted ? withRomanQuote(quoted.content, text) : text;
      const words = body.trim();
      const held = keyFor(words);
      const key = held ?? generateIdempotencyKey();
      // QUOTE-KEY-REOPEN-M: the quote as it went in these words travels with their key.
      const excerpt = quoted && sessionId && words !== text.trim() ? splitRomanQuote(words)?.quote : undefined;
      const quote = quoted && sessionId && excerpt ? { id: quoted.id, excerpt, session: sessionId } : undefined;
      // The key goes with these words before the request (LS-953R2 B1): a Back, a reopen or a restart before this
      // send ends finds it and sends it again. Only the answer that ends this send drops it (below).
      if (!held && words !== '') {
        if (fromChip) keepAside(words, key);
        else keepFailed(words, key, quote);
      }
      let kept = false;
      const outcome = await send(body, { key, keep: () => { kept = true; } });
      // Clear the composer ONLY when the turn actually persisted; on a send
      // failure the draft is preserved so the user can retry without retyping
      // (brief §3 / F5 RomanSendOutcome). A chip never clears a typed draft;
      // a chip that fails leaves its prompt in the composer to send again,
      // but only when the composer is empty: it never replaces a typed draft.
      let inBox = !fromChip;
      if (fromChip) {
        if (outcome === 'send-failed') {
          // setDraft runs this at once (lib/chatDrafts), so `inBox` says whether the prompt went into the box.
          setDraft((d) => {
            if (d.trim() !== '') return d;
            inBox = true;
            return text;
          });
        }
      } else if (outcome === 'sent' || outcome === 'stored-no-reply') {
        if (outcome === 'sent') setDraft('');
        // The quote goes once: a turn the server stored (answered or not) carries it,
        // so only the reply that went drops it; a failed send keeps both. While a stored turn's key is kept, the quote
        // stays too, so Send again rebuilds the same words.
        if (quoted && (outcome === 'sent' || !kept)) setReplyTarget((r) => (r?.id === quoted.id ? null : r));
      }
      if (outcome === 'noop') {
        if (!held && keyFor(words) === key) dropFailed(words); // nothing was sent under the new key
        return;
      }
      // The key stays with these words while Send again may replay it, otherwise it goes. A chip whose prompt did not
      // go into the box (another draft is there) keeps its key aside, so tapping it again replays it (LS-953 B2).
      if (outcome !== 'sent' && kept) {
        if (inBox) {
          if (fromChip) dropFailed(words); // the chip's words are in the box now: its key moves from aside to the box
          keepFailed(words, key, quote);
        } else keepAside(words, key);
      } else if (keyFor(words) === key) {
        dropFailed(words);
      }
    },
    [send, replyTarget, sessionId, setDraft, keyFor, keepFailed, keepAside, dropFailed],
  );

  const onSend = useCallback(async () => {
    await sendText(draft, false);
  }, [draft, sendText]);

  const onPickChip = useCallback(
    (prompt: string) => {
      setPickedChip(prompt);
      void sendText(prompt, true);
    },
    [sendText],
  );

  const onChangeDraft = useCallback(
    (text: string) => {
      setDraft(text);
      // A stale send-error must not linger while the user edits the draft (U2).
      if (sendError != null) clearSendError();
    },
    [sendError, clearSendError],
  );

  // Re-send the current draft from the visible retry affordance (U2).
  const onRetrySend = useCallback(() => {
    void onSend();
  }, [onSend]);

  // After a grant (or the coach's Try again) for a refusal that came in the
  // stream, the server already stored the message: never append it again on
  // its own. Re-read state is already shown; tell the person how to ask again
  // (Sol B-326-3). A refusal before the turn was stored re-sends as before.
  const onRefusalRetry = useCallback(() => {
    if (sendError?.turnStored) {
      clearSendError();
      setAskAgainHint(true);
      return;
    }
    onRetrySend();
  }, [sendError, clearSendError, onRetrySend]);

  // ROMAN-HOLD-M: hold one of Roman's replies for the people's chat menu. Client room only:
  // the coach's own Roman room is unchanged (a coach-visible change is the owner's call).
  const canHold = surface === 'client';
  const onHold = useCallback((m: RomanMessage) => {
    if (m.role === 'assistant') setActionTarget(m);
  }, []);

  const onReply = useCallback(() => {
    if (actionTarget) {
      dropKeptQuote(actionTarget.id);
      setReplyTarget(actionTarget);
    }
    setActionTarget(null);
  }, [actionTarget, dropKeptQuote]);

  const onCopy = useCallback(async () => {
    const held = actionTarget;
    setActionTarget(null);
    if (!held) return;
    try {
      await Clipboard.setStringAsync(held.content);
    } catch (err) {
      logger.warn('RomanChatScreen.copy', err);
    }
  }, [actionTarget]);

  const onOpenReport = useCallback(() => {
    if (actionTarget) setReportTarget(actionTarget);
    setActionTarget(null);
  }, [actionTarget]);

  // A failure throws to the sheet, which keeps the pick and says so; sending
  // again is safe: the server keeps one report per person and reply.
  const onSubmitReport = useCallback(
    async (payload: { reason: ReportReason; details?: string }) => {
      if (!reportTarget) return;
      await reportMessage(reportTarget.id, payload);
      // LS-950R2 C3: a late answer leaves a newer chat (or sign-in) alone: no sheet closed, no alert.
      if (chatNow.current !== chat) return;
      setReportTarget(null);
      Alert.alert('Reported', 'Your report has been submitted.');
    },
    [reportTarget, chat],
  );

  // B30: the reply that arrives after a send fades in like reading.
  const freshId = useRomanReveal(messages, sending);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RomanMessage>) => (
      <RomanMessageBubble
        message={item}
        reveal={item.id === freshId}
        reduceMotion={reduceMotion}
        onLongPress={canHold && item.role === 'assistant' ? onHold : undefined}
        testID={`roman-message-${item.id}`}
      />
    ),
    [freshId, reduceMotion, onHold, canHold],
  );

  // ROMAN-RETRY-B-M (#203-E41, "Roman's place, held"): the line that sat in a row under the list is Roman's card at
  // the end of the conversation (the list's footer, or under the greeting on an empty thread), so it scrolls with the
  // turns. Today's triggers bring it into view: the send's end (sending -> false, above) and the list's content size.
  const held =
    sendErrorCopy != null && !refusal ? (
      <RomanHeldCard
        testID="roman-send-error"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        line={sendErrorCopy}
        pending={sendErrorCopy === ROMAN_HELD_NOT_READY}
        onSendAgain={sendError?.kind !== 'rateLimited' && sendError?.kind !== 'poolEmpty' ? onRetrySend : undefined}
        sending={sending}
      />
    ) : askAgainHint && sendError == null ? (
      <RomanHeldCard testID="roman-ask-again" accessibilityLiveRegion="polite" line={ROMAN_AI_ON_ASK_AGAIN} />
    ) : null;
  // CREDITBUILD: the approved buy links under the coach's used-up line (flag off), unchanged, now under the card.
  const buyLinks =
    featureFlags.coachAiCredits && surface === 'coach' && sendError?.kind === 'poolEmpty' ? (
      <CreditPoolEmptyLinks inset={spacing.xl + 28 + spacing.sm} />
    ) : null;

  const header = (
    <View style={[styles.header, { borderBottomColor: sc.border }]}>
      <ScreenTopBar
        onBack={navigation ? () => navigation.goBack() : undefined}
        trailing={<RomanConversationsButton />}
        testID="roman-chat"
      />
      <View style={styles.titleBlock}>
        <Headline level="h1">Roman</Headline>
        <Overline testID="roman-chat-overline">{romanRoomOverline(surface, !coachless)}</Overline>
      </View>
    </View>
  );

  if (phase === 'requiresCoach' || sendError?.kind === 'requiresCoach') {
    return <RomanCoachLock />;
  }

  if (phase === 'loading') {
    return (
      <Screen edges={['top']} scroll={false} header={header} contentStyle={styles.body} testID="roman-chat-screen">
        <RomanLoadingSkeleton />
      </Screen>
    );
  }

  if (phase === 'unavailable' || phase === 'offline' || phase === 'error') {
    return (
      <Screen edges={['top']} scroll={false} header={header} contentStyle={styles.body} testID="roman-chat-screen">
        <RomanState
          kind={phase}
          onRetry={phase === 'unavailable' ? undefined : reload}
          testID="roman-chat-state"
        />
      </Screen>
    );
  }

  const composer = (
    <RomanComposer
      value={draft}
      onChangeText={onChangeDraft}
      onSend={onSend}
      sending={sending}
      accessory={
        replyTarget ? (
          <ReplyComposer
            target={{ id: replyTarget.id, body: romanQuoteExcerpt(replyTarget.content), authorLabel: 'Roman' }}
            onCancel={() => {
              dropKeptQuote();
              setReplyTarget(null);
            }}
          />
        ) : surface === 'client' ? (
          <RomanQuickStarts onPick={onPickChip} selected={pickedChip} disabled={sending} />
        ) : null
      }
      footer={surface === 'client' ? ROMAN_ROOM_FOOTER : null}
      maxLines={held ? 2 : undefined}
      testID="roman-composer"
    />
  );

  return (
    <Screen
      edges={['top']}
      scroll={false}
      header={header}
      footer={composer}
      contentStyle={styles.body}
      testID="roman-chat-screen"
    >
      <View style={styles.flex}>
        {isEmpty && held == null ? (
          <View style={styles.flex}>
            <RomanGreeting
              surface={surface}
              isFirstOpen={isFirstOpen}
              firstName={user?.firstName}
              testID="roman-empty-greeting"
            />
          </View>
        ) : isEmpty ? (
          // ROMAN-RETRY-B-M: the first send never stored, so the card sits under the greeting; at iPhone 320 with 130%
          // text the greeting alone fills the room, so they scroll, and the card's arrival brings it into view.
          <ScrollView
            ref={emptyScrollRef}
            style={styles.flex}
            onContentSizeChange={() => emptyScrollRef.current?.scrollToEnd({ animated: !reduceMotion })}
            testID="roman-empty-scroll"
          >
            <RomanGreeting
              surface={surface}
              isFirstOpen={isFirstOpen}
              firstName={user?.firstName}
              testID="roman-empty-greeting"
            />
            {held}
            {buyLinks}
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReachedThreshold={0.4}
            onEndReached={nextCursor != null ? loadOlder : undefined}
            onContentSizeChange={scrollToLatest}
            // Expose the thread as a list so assistive tech communicates the
            // navigational structure; each row carries role="listitem" in
            // RomanMessageBubble (R3 P1-3). The ARIA `role` prop is used (not
            // accessibilityRole) because RN's AccessibilityRole union omits
            // "listitem" while the `role` union types both list + listitem.
            role="list"
            ListFooterComponent={
              <>
                {held}
                {buyLinks}
                {loadingOlder ? (
                  <View
                    style={styles.olderNote}
                    testID="roman-loading-older"
                    accessibilityRole="progressbar"
                    accessibilityLabel={ROMAN_LOADING_OLDER}
                    accessibilityLiveRegion="polite"
                    accessibilityState={{ busy: true }}
                  >
                    <RomanAvatar crop="neutral" size={24} />
                    <Text style={[styles.olderNoteText, { color: sc.textMuted }]} accessibilityRole="text">
                      {ROMAN_LOADING_OLDER}
                    </Text>
                  </View>
                ) : null}
              </>
            }
            testID="roman-message-list"
          />
        )}

        {sending ? <RomanTypingIndicator testID="roman-typing" /> : null}

        {refusal ? (
          <AiRefusalNotice
            refusal={refusal}
            audience={refusalAudience}
            surface="roman"
            onRetry={onRefusalRetry}
            testID="roman-ai-refusal"
          />
        ) : null}

        <AiDailyCapModal
          cap={dailyCap}
          audience={refusalAudience}
          onClose={clearSendError}
          testID="roman-daily-cap"
        />

        {/* B32 (prototype 68): consent before Roman's first answer. */}
        {surface === 'client' ? <RomanConsentGate surface="client" /> : null}

        {/* ROMAN-RETRY-B-M: the send-error row and the buy links under it are Roman's card in the conversation (held). */}

        {/* ROMAN-HOLD-M: the people's chat hold menu and report sheet; REFINE-950: drawn as their GOAL frames draw them
            (dm-menu P3 b05, mobile-879-05) through look="roman", which only this room passes. */}
        <MessageActionSheet
          look="roman"
          visible={actionTarget != null}
          messagePreview={actionTarget ? romanQuoteExcerpt(actionTarget.content) : undefined}
          onReply={onReply}
          onCopy={() => void onCopy()}
          onReport={onOpenReport}
          onClose={() => setActionTarget(null)}
          canReport={actionTarget != null && !isLocalRomanId(actionTarget.id)}
          canReply={actionTarget?.safetyActions == null}
        />
        {/* LO-950R2 N3: keyed by chat, so a chat change also drops the sheet's pick, words and error. */}
        <ReportMessageSheet
          key={chat}
          look="roman"
          visible={reportTarget != null}
          messagePreview={reportTarget ? romanQuoteExcerpt(reportTarget.content, 400) : ''}
          onSubmit={onSubmitReport}
          onClose={() => setReportTarget(null)}
          revealError
        />

      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // The list and the states run edge to edge; rows carry their own gutter.
  body: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleBlock: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  olderNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  olderNoteText: {
    ...typography.bodySmall,
  },
});
