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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { getChatHistory, saveChatMessage } from '../../db/chatDb';
import NetInfo from '@react-native-community/netinfo';
import { aiApi, AIStructuredContext } from '../../services/api';

import { ChatMessage } from '../../types';
import { generateId } from '../../utils/date';
import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

// Quiet-luxury prompts. The AI is the coach's voice; the prompts should read
// like a coach asking, not a fitness app pushing keywords.
const QUICK_PROMPTS = [
  'Today’s focus',
  'Adjust my plan',
  'Meal ideas',
  'Recovery',
  'Training notes',
];

function TypingIndicator() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  useEffect(() => {
    const anim = (sv: { value: number }, delay: number) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 300 }),
            withTiming(0, { duration: 300 })
          ),
          -1,
          false
        )
      );
    };
    anim(dot1, 0);
    anim(dot2, 200);
    anim(dot3, 400);
  }, []);

  const style1 = useAnimatedStyle(() => ({ opacity: 0.3 + dot1.value * 0.7 }));
  const style2 = useAnimatedStyle(() => ({ opacity: 0.3 + dot2.value * 0.7 }));
  const style3 = useAnimatedStyle(() => ({ opacity: 0.3 + dot3.value * 0.7 }));

  return (
    <View style={styles.typingRow}>
      <View style={styles.aiBubble}>
        <View style={styles.dotRow}>
          <Animated.View style={[styles.dot, style1]} />
          <Animated.View style={[styles.dot, style2]} />
          <Animated.View style={[styles.dot, style3]} />
        </View>
      </View>
    </View>
  );
}

export default function AIGuideScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [coachName, setCoachName] = useState<string | undefined>(undefined);
  const [isOffline, setIsOffline] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);
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
      // message so the welcome header shows coach name without an eager
      // mount-time network call. The ref prevents re-fetching on subsequent
      // messages in the same session.
      if (!contextLoadedRef.current) {
        contextLoadedRef.current = true;
        try {
          const res = await aiApi.getStructuredContext();
          const ctx: AIStructuredContext | undefined = res.data;
          setCoachName(ctx?.coach?.name || ctx?.coach?.business_name);
          setContextReady(true);
        } catch {
          setContextReady(false);
        }
      }

      const userMsg: ChatMessage = {
        id: 'msg_' + generateId(),
        role: 'user',
        text: text.trim(),
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      await saveChatMessage(userId, userMsg);
      setInput('');
      setIsTyping(true);

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
          throw new Error('Empty API response');
        }

        // Successful network call — clear any previous offline state.
        setIsOffline(false);
        // Show degraded banner when the backend served a deterministic fallback.
        setIsDegraded(response.data?.degraded === true);
      } catch (err) {
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
        aiText =
          "Your coach's guidance is briefly unavailable — please try again in a minute.";
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
      await saveChatMessage(userId, aiMsg);
    },
    [userId, currentUser, messages]
  );

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.aiRow]}>
        {!isUser && (
          <View style={styles.aiAvatar}>
            <Text style={styles.aiAvatarText}>GP</Text>
          </View>
        )}
        <View style={[isUser ? styles.userBubble : styles.aiBubble]}>
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
          <Ionicons name="cloud-offline-outline" size={14} color={colors.textOnPrimary} />
          <Text style={styles.offlineBannerText}>
            You’re offline. Message will send when connection returns.
          </Text>
        </View>
      )}
      {/* Degraded banner — shown when backend served deterministic fallback */}
      {isDegraded && !isOffline && (
        <View style={styles.degradedBanner}>
          <Text style={styles.degradedBannerText}>
            AI guidance is running in offline mode — responses may be limited.
          </Text>
        </View>
      )}
      <FadeInView>
        <View style={styles.header}>
          <Text style={styles.title}>Guidance</Text>
          {coachName ? (
            <Text style={styles.subTitle}>Trained on {coachName}'s approach</Text>
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
              <Ionicons name="chatbubble-ellipses" size={40} color={colors.primary} />
              <Text style={styles.welcomeTitle}>
                Hello{currentUser?.firstName ? `, ${currentUser.firstName}` : ''}.
              </Text>
              <Text style={styles.welcomeText}>
                {coachName
                  ? `Trained on ${coachName}'s approach. I have your goals, recent logs, and check-ins on hand.`
                  : 'Trained on your coach’s approach. I have your goals, recent logs, and check-ins on hand.'}
              </Text>
              {!contextReady ? (
                <Text style={styles.welcomeFooter}>Working offline. Replies are generic until you reconnect.</Text>
              ) : null}
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
                onPress={() => sendMessage(item)}
              >
                <Text style={styles.quickChipText}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          placeholder="Ask me anything..."
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
          accessibilityLabel={isOffline ? 'Send disabled — you are offline' : 'Send message'}
        >
          <Ionicons
            name="send"
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
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  messageRow: {
    marginVertical: 4,
    flexDirection: 'row',
    maxWidth: '85%',
  },
  userRow: {
    alignSelf: 'flex-end',
  },
  aiRow: {
    alignSelf: 'flex-start',
    gap: 8,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 4, // radius.lg
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiBubble: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexShrink: 1,
  },
  userText: {
    fontSize: 15,
    color: colors.textOnPrimary,
    lineHeight: 21,
  },
  aiText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 21,
  },
  aiAvatar: {
    width: 30,
    height: 30,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  aiAvatarText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    color: colors.textOnPrimary,
  },
  typingRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginVertical: 4,
    marginLeft: 38,
  },
  dotRow: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textSecondary,
  },
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
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  welcomeFooter: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  quickRow: {
    paddingBottom: 8,
  },
  quickContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  quickChip: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
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
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineBannerText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textOnPrimary,
    flex: 1,
  },
  degradedBanner: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  degradedBannerText: {
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },

  });
