import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { getChatHistory, saveChatMessage } from '../../db/chatDb';
import NetInfo from '@react-native-community/netinfo';
import { aiApi, AIStructuredContext } from '../../services/api';

import { ChatMessage } from '../../types';
import { generateId } from '../../utils/date';
import FadeInView from '../../components/FadeInView';
import AiRefusalNotice from '../../components/ai/AiRefusalNotice';
import AiDailyCapModal from '../../components/ai/AiDailyCapModal';
import { aiRefusalOf, type AiRefusal } from '../../lib/ai/aiRefusal';
import { aiDailyCapOf, type AiDailyCap } from '../../lib/ai/aiDailyCap';
import { shortReference, supportReferenceOf, diagnosticReference } from '../../utils/correlation';
import { captureError } from '../../services/sentry';
import { typography } from '../../theme/tokens';

/** The HTTP status of a failed request, or null (no other error detail is reported). */
function httpStatusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const response = 'response' in err ? err.response : undefined;
  if (typeof response === 'object' && response !== null && 'status' in response && typeof response.status === 'number') {
    return response.status;
  }
  return null;
}
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

// Neutral shortcuts: none assumes a coach or an assigned plan.
const QUICK_PROMPTS = [
  'Today’s focus',
  'Plan adjustments',
  'Meal ideas',
  'Recovery',
  'Training notes',
];

function TypingIndicator() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.typingRow} accessibilityLiveRegion="polite">
      <Text style={styles.subTitle}>Preparing a reply</Text>
    </View>
  );
}


/**
 * A 200 from the guide with no reply text. Carries the response so the
 * request's reference survives into the failure branch.
 */
class EmptyGuideReplyError extends Error {
  readonly response: unknown;
  readonly config: unknown;
  constructor(response: { config?: unknown } | null | undefined) {
    super('Empty API response');
    this.name = 'EmptyGuideReplyError';
    this.response = response ?? undefined;
    this.config = response?.config;
  }
}

export default function AIGuideScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [coachName, setCoachName] = useState<string | undefined>(undefined);
  const [isOffline, setIsOffline] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);
  // R2b: a consent / egress refusal from POST /ai/chat (403
  // ai_consent_required, 503 ai_egress_blocked). Shown as its own notice
  // with a working action; never an invented AI reply.
  const [refusal, setRefusal] = useState<AiRefusal | null>(null);
  const [refusedText, setRefusedText] = useState<string | null>(null);
  // 429 AI_DAILY_QUOTA_EXCEEDED: the daily AI cap pop-up, never the generic
  // service-problem reply.
  const [dailyCap, setDailyCap] = useState<AiDailyCap | null>(null);
  const listRef = useRef<FlatList>(null);

  const userId = currentUser?.id || '';
  // M4 — Lazy context load. We no longer prefetch structured context on
  // mount because most users open the screen without typing a message.
  // Instead, context is fetched on the first send and the result cached via
  // this ref so subsequent messages in the same session skip the round-trip.
  const contextLoadedRef = useRef(false);

  useEffect(() => {
    if (userId) {
      loadChat();
    }
  }, [userId]);

  const loadChat = async () => {
    const history = await getChatHistory(userId);
    setMessages(history);
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !userId) return;

      // M4 — Lazy context load: fetch structured context before the first
      // message so the header can show a returned coach name without an eager
      // mount-time network call. The ref prevents re-fetching on subsequent
      // messages in the same session.
      if (!contextLoadedRef.current) {
        contextLoadedRef.current = true;
        try {
          const res = await aiApi.getStructuredContext();
          const ctx: AIStructuredContext | undefined = res.data;
          setCoachName(ctx?.coach?.name || ctx?.coach?.business_name);
        } catch {
          // No coach label is shown when context is unavailable.
        }
      }

      const userMsg: ChatMessage = {
        id: 'msg_' + generateId(),
        role: 'user',
        text: text.trim(),
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsTyping(true);
      setRefusal(null);
      setRefusedText(null);

      let aiText = '';

      try {
        // Build short conversation history for short-term continuity. The
        // backend is responsible for assembling structured context (coach,
        // macros, recent logs, persona, guardrails) — the mobile app sends
        // ONLY the user's message text and last few turns.
        const history = messages.slice(-10).map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text,
        }));

        const response = await aiApi.chat(text.trim(), history);
        aiText = response.data?.reply || response.data?.message || response.data?.response || '';

        if (!aiText) {
          // Keep the response, so the reference of THIS request is shown and
          // reported (Sol B-326-4).
          throw new EmptyGuideReplyError(response);
        }

        // Successful network call — clear any previous offline state.
        setIsOffline(false);
        // Show degraded banner when the backend served a deterministic fallback.
        setIsDegraded(response.data?.degraded === true);
      } catch (err) {
        // R2b: the server refused to send this to the AI provider. Nothing was
        // answered, so the turn is not kept; the draft goes back in the input
        // and the notice offers the working next step.
        const refused = aiRefusalOf(err);
        if (refused) {
          setIsTyping(false);
          setInput(text.trim());
          setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
          setRefusal(refused);
          setRefusedText(text.trim());
          return;
        }

        // Daily AI cap: nothing was answered, so the turn is not kept; the
        // draft goes back in the input and the pop-up says when it resets.
        const cap = aiDailyCapOf(err);
        if (cap) {
          setIsTyping(false);
          setInput(text.trim());
          setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
          setDailyCap(cap);
          return;
        }

        // Detect axios network-level failures (no response from server). These
        // can happen on a flaky connection even when NetInfo still reports
        // reachable, so we treat them as the "offline" branch.
        const isAxiosNetworkError =
          err != null &&
          typeof err === 'object' &&
          (('code' in err && (err as { code: string }).code === 'ERR_NETWORK') ||
            ('response' in err && (err as { response: unknown }).response == null));

        // Cross-check with NetInfo — if the device is genuinely offline we
        // also want the offline branch even if axios surfaced a different
        // error shape (e.g. an Empty API response while the radio was off).
        let isDeviceOffline = false;
        try {
          const state = await NetInfo.fetch();
          isDeviceOffline =
            state.isConnected === false || state.isInternetReachable === false;
        } catch {
          // NetInfo can reject on early boot — treat as unknown (not offline).
        }

        if (isAxiosNetworkError || isDeviceOffline) {
          setIsOffline(true);
          setIsTyping(false);
          // Keep the draft in the input field — don't clear it — so the user
          // can resend once connectivity is restored.
          setInput(text.trim());
          // Remove the optimistic user message we already added since we're
          // not completing the round-trip.
          setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
          return;
        }

        // Non-network error (backend 5xx, empty/malformed response). The AI
        // gateway doctrine (src/types/aiGateway.ts) requires the UI to render
        // a fail-closed state and NEVER substitute a fabricated answer for a
        // disabled response. Previously we ran a hardcoded keyword matcher
        // labelled "Offline reply" — a lie when the user was online. (Hunt
        // P0-aiGuide / R18)
        // Owner rule 2026-10-01 13:34: an unknown failure says what happened,
        // the next step, and a short reference for support, and is reported.
        // B-326-4: always a reference. The request's own when known,
        // otherwise a generated one; the same value goes to Sentry.
        const fullRef = diagnosticReference(supportReferenceOf(err));
        const ref = shortReference(fullRef);
        // Checklist (a): no exception text leaves the phone, only a fixed
        // event name, the HTTP status and the reference.
        captureError(new Error('ai_guide request failed'), {
          surface: 'ai_guide',
          reference: fullRef,
          status: httpStatusOf(err),
        });
        aiText =
          'Guidance could not answer this time because of a problem with The Growth Project service. ' +
          'Send your message again in a minute. If it keeps happening, contact support' +
          (ref ? ` and share reference ${ref}.` : '.');
        setIsDegraded(true);
      }

      const aiMsg: ChatMessage = {
        id: 'msg_' + generateId(),
        role: 'ai',
        text: aiText,
        timestamp: new Date().toISOString(),
      };

      setIsTyping(false);
      setMessages((prev) => [...prev, aiMsg]);
      // The user turn is stored only once the request settled with a reply
      // (or the fail-closed note), so an offline or refused turn that was
      // rolled back never reappears from history.
      await saveChatMessage(userId, userMsg);
      await saveChatMessage(userId, aiMsg);
    },
    [userId, currentUser, messages]
  );

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
        <View style={[isUser ? styles.userBubble : styles.aiBubble]}>
          <Text style={[styles.subTitle, isUser && styles.userLabel]}>{isUser ? 'YOU' : 'GUIDANCE'}</Text>
          <Text style={[isUser ? styles.userText : styles.aiText]}>{item.text}</Text>
        </View>
      </View>
    );
  };

  // Inverted list data
  const invertedMessages = [...messages].reverse();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Offline banner — shown when a network error is detected */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.offlineBannerText}>
            Connection unavailable. The message remains in the input.
          </Text>
        </View>
      )}
      {/* Degraded banner — shown when backend served deterministic fallback */}
      {isDegraded && !isOffline && (
        <View style={styles.degradedBanner}>
          <Text style={styles.degradedBannerText}>
            Limited guidance is available for this reply.
          </Text>
        </View>
      )}
      <FadeInView>
        <View style={styles.header}>
          <Text style={styles.title}>Guidance</Text>
          {coachName ? (
            <Text style={styles.subTitle}>Coach · {coachName}</Text>
          ) : null}
        </View>
      </FadeInView>

      <FlatList
        ref={listRef}
        data={invertedMessages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        inverted
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={isTyping ? <TypingIndicator /> : null}
        ListFooterComponent={
          messages.length === 0 ? (
            <View style={styles.welcomeContainer}>
              <Text style={styles.welcomeTitle}>
                Hello{currentUser?.firstName ? `, ${currentUser.firstName}` : ''}.
              </Text>
              <Text style={styles.welcomeText}>
                Ask about training, food or recovery.
              </Text>
            </View>
          ) : null
        }
      />

      {/* Quick Prompts */}
      {messages.length < 3 && (
        <View style={styles.quickRow}>
          <FlatList
            data={QUICK_PROMPTS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.quickContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.quickChip}
                accessibilityRole="button"
                onPress={() => sendMessage(item)}
              >
                <Text style={styles.quickChipText}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {refusal ? (
        <AiRefusalNotice
          refusal={refusal}
          audience="client"
          surface="guide"
          onRetry={refusedText ? () => void sendMessage(refusedText) : undefined}
          testID="ai-guide-refusal"
        />
      ) : null}

      <AiDailyCapModal
        cap={dailyCap}
        audience="client"
        onClose={() => setDailyCap(null)}
        testID="ai-guide-daily-cap"
      />

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          placeholder="Ask about training, food or recovery"
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={() => sendMessage(input)}
          blurOnSubmit
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || isOffline) && styles.sendBtnDisabled]}
          onPress={() => sendMessage(input)}
          disabled={!input.trim() || isOffline}
          accessibilityRole="button"
          accessibilityLabel={isOffline ? 'Send disabled: connection unavailable' : 'Send message'}
        >
          <Ionicons
            name="arrow-forward-outline"
            size={20}
            color={input.trim() ? colors.textOnPrimary : colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  subTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 1.98,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: 8,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  messageRow: {
    marginVertical: 16,
    flexDirection: 'row',
    maxWidth: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: 20,
  },
  userRow: {
    alignSelf: 'flex-end',
  },
  aiRow: {
    alignSelf: 'flex-start',
    gap: 8,
  },
  userBubble: {
    gap: 8,
    borderRadius: 4, // radius.lg
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiBubble: {
    gap: 8,
    borderRadius: 4, // radius.lg
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexShrink: 1,
  },
  userText: {
    ...typography.body,
    fontSize: 15,
    color: colors.textPrimary,
    textAlign: 'right',
    lineHeight: 21,
  },
  aiText: {
    ...typography.body,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  typingRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginVertical: 4,
    marginLeft: 14,
  },
  userLabel: { textAlign: 'right' },
  welcomeContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 8,
  },
  welcomeTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  welcomeText: {
    ...typography.bodySmall,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  quickRow: {
    paddingBottom: 8,
  },
  quickContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  quickChip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 0,
    borderColor: colors.border,
  },
  quickChipText: {
    ...typography.bodySmall,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 10,
  },
  textInput: {
    ...typography.body,
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.surfaceElevated,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineBannerText: {
    ...typography.bodySmall,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  degradedBanner: {
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  degradedBannerText: {
    ...typography.bodySmall,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },

  });
