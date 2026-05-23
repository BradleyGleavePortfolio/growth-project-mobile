/**
 * MessageBubble — iMessage-grade DM bubble with long-press affordance.
 *
 * Renders a single chat bubble for the DM thread. The bubble itself is wrapped
 * in a Pressable that surfaces `onLongPress` which is the entry point to the
 * action sheet (Reply / Copy / Report).
 *
 * Visual rules:
 *   - "me" bubbles render in colors.primary with white text
 *   - "them" bubbles render in colors.surface with primary text
 *   - replies render a quoted parent stub above the bubble body
 *   - the long-press hold triggers a selection haptic
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

export interface BubbleMessage {
  id: string;
  body: string;
  created_at: string;
  pending?: boolean;
  read_at?: string | null;
  parent?: {
    id: string;
    body: string;
    sender_role: 'coach' | 'client';
  } | null;
}

export interface MessageBubbleProps {
  message: BubbleMessage;
  isMe: boolean;
  receipt?: React.ReactNode;
  onLongPress: (m: BubbleMessage) => void;
  onPressParent?: (parentId: string) => void;
}

export function MessageBubble({
  message,
  isMe,
  receipt,
  onLongPress,
  onPressParent,
}: MessageBubbleProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handleLongPress = (): void => {
    HapticService.selection();
    onLongPress(message);
  };

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <View
      style={[
        styles.row,
        isMe ? styles.rowRight : styles.rowLeft,
        message.pending ? styles.rowPending : undefined,
      ]}
    >
      <Pressable
        onLongPress={handleLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`Message: ${message.body}. Long press for actions.`}
        accessibilityHint="Long press to reply, copy, or report this message."
        style={({ pressed }) => [
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          pressed && styles.bubblePressed,
        ]}
      >
        {message.parent ? (
          <Pressable
            onPress={
              onPressParent && message.parent
                ? () => onPressParent(message.parent!.id)
                : undefined
            }
            style={[
              styles.replyStub,
              isMe ? styles.replyStubMe : styles.replyStubThem,
            ]}
            accessibilityRole={onPressParent ? 'button' : undefined}
            accessibilityLabel={`Replying to: ${message.parent.body}`}
          >
            <View style={styles.replyStubBar} />
            <Text
              numberOfLines={2}
              style={[
                styles.replyStubText,
                isMe ? styles.replyStubTextMe : styles.replyStubTextThem,
              ]}
            >
              {message.parent.body}
            </Text>
          </Pressable>
        ) : null}

        <Text style={[styles.body, isMe && styles.bodyMe]}>{message.body}</Text>
        <Text style={[styles.time, isMe && styles.timeMe]}>
          {formatTime(message.created_at)}
          {message.pending ? '  ' : ''}
          {message.pending ? (
            <Ionicons name="time-outline" size={10} color={colors.textMuted} />
          ) : null}
        </Text>
      </Pressable>

      {receipt ? <View style={styles.receiptWrap}>{receipt}</View> : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: { marginBottom: 6 },
    rowRight: { alignItems: 'flex-end' },
    rowLeft: { alignItems: 'flex-start' },
    rowPending: { opacity: 0.55 },

    bubble: {
      maxWidth: '78%',
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    bubbleMe: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
    bubbleThem: {
      backgroundColor: colors.surface,
      borderBottomLeftRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bubblePressed: { opacity: 0.85 },

    body: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
    bodyMe: { color: colors.textOnPrimary },

    time: { fontSize: 11, color: colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },
    timeMe: { color: colors.textOnPrimary + 'B3' },

    receiptWrap: { marginTop: 2, alignSelf: 'flex-end' },

    replyStub: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: 8,
      marginBottom: 6,
    },
    replyStubMe: { backgroundColor: colors.textOnPrimary + '22' },
    replyStubThem: { backgroundColor: colors.border + '88' },
    replyStubBar: {
      width: 3,
      alignSelf: 'stretch',
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    replyStubText: { flex: 1, fontSize: 12, lineHeight: 16 },
    replyStubTextMe: { color: colors.textOnPrimary + 'DD' },
    replyStubTextThem: { color: colors.textSecondary },
  });

export default MessageBubble;
