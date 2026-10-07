/**
 * MessageBubble — iMessage-grade DM bubble with long-press affordance.
 *
 * Renders a single chat bubble for the DM thread. The bubble itself is wrapped
 * in a Pressable that surfaces `onLongPress` which is the entry point to the
 * action sheet (Reply / Copy / Report).
 *
 * Visual rules:
 *   - own messages align right with a forest hairline
 *   - incoming messages align left on the page, without a bubble fill
 *   - replies render a quoted parent stub above the bubble body
 *   - the long-press hold triggers a selection haptic
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useThreadColors, type ThreadColors } from './thread/useThreadColors';
import { typography } from '../../theme/tokens';

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
  /** messaging v2: tombstone (delete for everyone erased the content), edited, pinned in this thread. */
  deleted?: boolean;
  edited?: boolean;
  pinned?: boolean;
}

export interface MessageBubbleProps {
  message: BubbleMessage;
  isMe: boolean;
  receipt?: React.ReactNode;
  showTimestamp?: boolean;
  onLongPress: (m: BubbleMessage) => void;
  onPressParent?: (parentId: string) => void;
}

export function MessageBubble({
  message,
  isMe,
  receipt,
  showTimestamp = true,
  onLongPress,
  onPressParent,
}: MessageBubbleProps): React.ReactElement {
  const colors = useThreadColors();
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
        accessibilityLabel={
          message.deleted
            ? 'Message deleted.'
            : `Message: ${message.body}.${message.edited ? ' Edited.' : ''}${message.pinned ? ' Pinned.' : ''} Long press for actions.`
        }
        accessibilityHint="Long press for message actions."
        style={({ pressed }) => [
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          pressed && styles.bubblePressed,
        ]}
      >
        {message.parent && !message.deleted ? (
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

        {message.deleted ? (
          <Text style={[styles.body, styles.bodyDeleted, isMe && styles.timeMe]}>Message deleted</Text>
        ) : (
          <Text style={[styles.body, isMe && styles.bodyMe]}>{message.body}</Text>
        )}
        {(showTimestamp || message.edited || message.pinned || message.pending) && <Text style={[styles.time, isMe && styles.timeMe]}>
          {message.deleted ? '' : `${message.pinned ? 'Pinned  ' : ''}${message.edited ? 'Edited  ' : ''}`}
          {showTimestamp ? formatTime(message.created_at) : ''}
          {message.pending ? '  ' : ''}
          {message.pending ? (
            <Ionicons name="time-outline" size={10} color={colors.textMuted} />
          ) : null}
        </Text>}
      </Pressable>

      {receipt ? <View style={styles.receiptWrap}>{receipt}</View> : null}
    </View>
  );
}

const makeStyles = (colors: ThreadColors) =>
  StyleSheet.create({
    row: { marginBottom: 12 },
    rowRight: { alignItems: 'flex-end' },
    rowLeft: { alignItems: 'flex-start' },
    rowPending: { opacity: 1 },

    bubble: {
      maxWidth: '78%',
      borderRadius: 4,
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    bubbleMe: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.primary },
    bubbleThem: {
      backgroundColor: colors.background,
    },
    bubblePressed: { opacity: 0.85 },

    body: { ...typography.body, color: colors.textPrimary },
    bodyMe: { color: colors.textPrimary },
    bodyDeleted: { fontStyle: 'italic', color: colors.textMuted },

    time: { ...typography.bodySmall, fontSize: 13, color: colors.textMuted, marginTop: 4, alignSelf: 'flex-end', fontVariant: ['tabular-nums'] },
    timeMe: { color: colors.textMuted },

    receiptWrap: { marginTop: 2, alignSelf: 'flex-end' },

    replyStub: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: 4,
      minHeight: 44,
      marginBottom: 6,
    },
    replyStubMe: { backgroundColor: colors.background },
    replyStubThem: { backgroundColor: colors.background },
    replyStubBar: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: colors.primary,
      borderRadius: 2,
    },
    replyStubText: { ...typography.bodySmall, flex: 1, fontSize: 13 },
    replyStubTextMe: { color: colors.textMuted },
    replyStubTextThem: { color: colors.textSecondary },
  });

export default MessageBubble;
