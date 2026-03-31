import React, { useEffect, useState, useRef, useCallback } from 'react';
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
import { useAuthStore } from '../../store/authStore';
import { getChatHistory, saveChatMessage } from '../../db/chatDb';
import { getAIResponse } from '../../utils/aiGuide';
import { Colors } from '../../constants/colors';
import { ChatMessage } from '../../types';
import { generateId } from '../../utils/date';
import FadeInView from '../../components/FadeInView';

const QUICK_PROMPTS = [
  'How many calories?',
  'Protein tips',
  'Meal ideas',
  'Motivation',
  'Workout plan',
  'Fasting help',
];

function TypingIndicator() {
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
  const { currentUser, clientProfile } = useAuthStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const listRef = useRef<FlatList>(null);

  const userId = currentUser?.id || '';

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

      // Simulate typing delay
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

      const daysSinceStart = currentUser?.createdAt
        ? Math.floor((Date.now() - new Date(currentUser.createdAt).getTime()) / (1000 * 60 * 60 * 24))
        : 1;

      const aiText = getAIResponse(text, {
        firstName: currentUser?.firstName || 'there',
        profile: clientProfile,
        daysSinceStart,
        loggingStreak: 0,
      });

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
    [userId, currentUser, clientProfile]
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
      <FadeInView>
        <View style={styles.header}>
          <Text style={styles.title}>AI Guide</Text>
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
              <Ionicons name="chatbubble-ellipses" size={40} color={Colors.primary} />
              <Text style={styles.welcomeTitle}>
                Hey{currentUser?.firstName ? `, ${currentUser.firstName}` : ''}!
              </Text>
              <Text style={styles.welcomeText}>
                I'm your AI nutrition guide. Ask me about calories, macros, meal ideas, workouts, fasting, or anything fitness related.
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
          placeholderTextColor={Colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={() => sendMessage(input)}
          blurOnSubmit
        />
        <TouchableOpacity
          style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
          onPress={() => sendMessage(input)}
          disabled={!input.trim()}
        >
          <Ionicons
            name="send"
            size={20}
            color={input.trim() ? Colors.textOnPrimary : Colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
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
    backgroundColor: Colors.primary,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiBubble: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexShrink: 1,
  },
  userText: {
    fontSize: 15,
    color: Colors.textOnPrimary,
    lineHeight: 21,
  },
  aiText: {
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  aiAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  aiAvatarText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textOnPrimary,
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
    backgroundColor: Colors.textSecondary,
  },
  welcomeContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 8,
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  welcomeText: {
    fontSize: 14,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.surfaceElevated,
  },
});
