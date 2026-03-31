import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { aiApi } from '../services/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface FloatingChatWidgetProps {
  visible?: boolean;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function FloatingChatWidget({ visible = true }: FloatingChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const openChat = () => setIsOpen(true);
  const closeChat = () => setIsOpen(false);

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputText('');
    setIsLoading(true);

    // Scroll to bottom
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      // Build conversation history for API (last 10 messages)
      const history = updatedMessages.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await aiApi.chat(userMessage.content, history.slice(0, -1));
      const { reply } = response.data;

      const assistantMessage: Message = {
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      const errorMessage: Message = {
        role: 'assistant',
        content: 'GP is offline right now. Check your connection and try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!visible && !isOpen) return null;

  return (
    <>
      {/* Floating GP button — hidden when chat modal is open or visibility is off */}
      <TouchableOpacity style={[styles.fab, (isOpen || !visible) && styles.fabHidden]} onPress={openChat} activeOpacity={0.85}>
        <Text style={styles.fabText}>GP</Text>
      </TouchableOpacity>

      {/* Chat panel modal */}
      <Modal
        visible={isOpen}
        animationType="slide"
        transparent
        onRequestClose={closeChat}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={closeChat}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.panelContainer}
        >
          <View style={styles.panel}>
            {/* Panel header */}
            <View style={styles.panelHeader}>
              <View style={styles.gpBadge}>
                <Text style={styles.gpBadgeText}>GP</Text>
              </View>
              <View style={styles.panelHeaderInfo}>
                <Text style={styles.panelTitle}>GP — Your Coach</Text>
                <View style={styles.onlineRow}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.onlineText}>Online</Text>
                </View>
              </View>
              <TouchableOpacity onPress={closeChat} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Messages area */}
            <ScrollView
              ref={scrollRef}
              style={styles.messageArea}
              contentContainerStyle={styles.messageContent}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length === 0 && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateTitle}>Ask GP anything</Text>
                  <Text style={styles.emptyStateBody}>
                    Nutrition, training, fasting, mindset — GP knows it all.
                  </Text>
                  <View style={styles.suggestions}>
                    {['What should I eat today?', 'How much protein do I need?', 'Best pre-workout meal?'].map(s => (
                      <TouchableOpacity
                        key={s}
                        style={styles.suggestionChip}
                        onPress={() => setInputText(s)}
                      >
                        <Text style={styles.suggestionText}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {messages.slice(-5).map((msg, i) => (
                <View
                  key={i}
                  style={[
                    styles.messageBubble,
                    msg.role === 'user' ? styles.userBubble : styles.gpBubble,
                  ]}
                >
                  <Text style={[
                    styles.messageText,
                    msg.role === 'user' ? styles.userMessageText : styles.gpMessageText,
                  ]}>
                    {msg.content}
                  </Text>
                  <Text style={styles.messageTime}>{formatTime(msg.timestamp)}</Text>
                </View>
              ))}

              {isLoading && (
                <View style={[styles.messageBubble, styles.gpBubble, styles.typingBubble]}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.typingText}>GP is thinking...</Text>
                </View>
              )}
            </ScrollView>

            {/* Input area */}
            <View style={styles.inputArea}>
              <TextInput
                style={styles.chatInput}
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ask GP anything..."
                placeholderTextColor={Colors.textMuted}
                multiline
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={sendMessage}
              />
              <TouchableOpacity
                style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
                onPress={sendMessage}
                disabled={!inputText.trim() || isLoading}
              >
                <Text style={styles.sendButtonText}>↑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.button,
    zIndex: 1000,
  },
  fabHidden: {
    display: 'none',
  },
  fabText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.5,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 31, 38, 0.4)',
  },
  panelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  panel: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    height: SCREEN_HEIGHT * 0.62,
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  gpBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  gpBadgeText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  panelHeaderInfo: { flex: 1 },
  panelTitle: { ...Typography.h3 },
  onlineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
    marginRight: 4,
  },
  onlineText: { fontSize: 12, color: Colors.textMuted },
  closeButton: { padding: Spacing.sm },
  closeButtonText: { fontSize: 18, color: Colors.textMuted },
  messageArea: { flex: 1 },
  messageContent: { padding: Spacing.md, paddingBottom: Spacing.sm },
  emptyState: { alignItems: 'center', paddingTop: Spacing.xl },
  emptyStateTitle: { ...Typography.h3, marginBottom: Spacing.sm },
  emptyStateBody: { ...Typography.body, textAlign: 'center', marginBottom: Spacing.lg, lineHeight: 22 },
  suggestions: { width: '100%' },
  suggestionChip: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.full,
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  suggestionText: { color: Colors.primary, fontSize: 14 },
  messageBubble: {
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    maxWidth: '80%',
  },
  userBubble: {
    backgroundColor: Colors.primary,
    alignSelf: 'flex-end',
  },
  gpBubble: {
    backgroundColor: Colors.surface,
    alignSelf: 'flex-start',
    ...Shadow.card,
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  userMessageText: { color: Colors.white },
  gpMessageText: { color: Colors.dark },
  messageTime: { fontSize: 11, marginTop: 4 },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typingText: { color: Colors.textMuted, fontSize: 13, marginLeft: Spacing.sm },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
    color: Colors.dark,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendButton: {
    marginLeft: Spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: Colors.border },
  sendButtonText: { color: Colors.white, fontSize: 18, fontWeight: '700' },
});
