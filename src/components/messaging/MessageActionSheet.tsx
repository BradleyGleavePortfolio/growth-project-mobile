/**
 * MessageActionSheet — long-press action menu for a message bubble.
 *
 * iOS uses the native ActionSheetIOS; Android falls back to a themed Modal
 * with the same set of actions so behaviour is identical across platforms.
 *
 * Actions:
 *   - Reply  — primes the composer with a quoted parent reference.
 *   - Copy   — copies the bubble body to the system clipboard.
 *   - Report — opens the ReportMessageSheet to capture a reason + free text.
 */
import React, { useEffect, useMemo, useCallback } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

export interface MessageActionSheetProps {
  visible: boolean;
  messagePreview?: string;
  onReply: () => void;
  onCopy: () => void;
  onReport: () => void;
  onClose: () => void;
}

export function MessageActionSheet({
  visible,
  messagePreview,
  onReply,
  onCopy,
  onReport,
  onClose,
}: MessageActionSheetProps): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'ios') return;
    const options = ['Reply', 'Copy', 'Report Message', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: 3,
        destructiveButtonIndex: 2,
        title: messagePreview ? truncate(messagePreview, 80) : undefined,
        userInterfaceStyle: 'light',
      },
      (idx) => {
        onClose();
        if (idx === 0) onReply();
        else if (idx === 1) onCopy();
        else if (idx === 2) onReport();
      },
    );
    // The parent re-toggles `visible` to re-trigger the native sheet;
    // including handlers would risk double-firing during re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleReply = useCallback(() => {
    onClose();
    onReply();
  }, [onClose, onReply]);
  const handleCopy = useCallback(() => {
    onClose();
    onCopy();
  }, [onClose, onCopy]);
  const handleReport = useCallback(() => {
    onClose();
    onReport();
  }, [onClose, onReport]);

  if (Platform.OS === 'ios') return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          {messagePreview ? (
            <Text style={styles.preview} numberOfLines={2}>
              {messagePreview}
            </Text>
          ) : null}
          <ActionRow icon="return-up-back-outline" label="Reply" onPress={handleReply} styles={styles} color={colors.textPrimary} />
          <ActionRow icon="copy-outline" label="Copy" onPress={handleCopy} styles={styles} color={colors.textPrimary} />
          <ActionRow icon="flag-outline" label="Report Message" onPress={handleReport} styles={styles} color={colors.error} destructive />
          <Pressable onPress={onClose} style={styles.cancelRow} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface ActionRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  color: string;
  destructive?: boolean;
}

function ActionRow({ icon, label, onPress, styles, color, destructive }: ActionRowProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.rowText, destructive && { color }]}>{label}</Text>
    </Pressable>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 8,
      paddingBottom: 36,
      paddingHorizontal: 8,
    },
    preview: {
      fontSize: 12,
      color: colors.textMuted,
      paddingVertical: 10,
      paddingHorizontal: 12,
      textAlign: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 12,
    },
    rowPressed: { backgroundColor: colors.background },
    rowText: { fontSize: 16, color: colors.textPrimary },
    cancelRow: {
      marginTop: 8,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      borderRadius: 12,
      backgroundColor: colors.background,
    },
    cancelText: { fontSize: 16, color: colors.textPrimary, fontWeight: '600' },
  });

export default MessageActionSheet;
