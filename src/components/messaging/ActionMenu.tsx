/**
 * ActionMenu — a cross-platform list of actions for one item (a conversation
 * row in the inbox, a message bubble in a thread).
 *
 * iOS shows the native ActionSheetIOS; Android shows a themed bottom sheet
 * with the same rows in the same order, so behaviour is identical on both.
 * The menu closes before the chosen action runs, and each tap runs exactly
 * one action.
 */
import React, { useEffect, useMemo } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

export interface ActionMenuOption {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
}

export interface ActionMenuProps {
  visible: boolean;
  title?: string;
  options: ReadonlyArray<ActionMenuOption>;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function ActionMenu({ visible, title, options, onSelect, onClose }: ActionMenuProps): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'ios') return;
    const labels = [...options.map((o) => o.label), 'Cancel'];
    const destructive = options.findIndex((o) => o.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
        title,
      },
      (idx) => {
        onClose();
        const chosen = options[idx];
        if (chosen) onSelect(chosen.key);
      },
    );
    // The parent toggles `visible` to open the native sheet; re-running on
    // handler identity changes would open it twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (Platform.OS === 'ios' || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          {title ? (
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {options.map((o) => (
            <Pressable
              key={o.key}
              onPress={() => {
                onClose();
                onSelect(o.key);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={o.label}
            >
              <Ionicons name={o.icon} size={20} color={o.destructive ? colors.error : colors.textPrimary} />
              <Text style={[styles.rowText, o.destructive && { color: colors.error }]}>{o.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} style={styles.cancelRow} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 8,
      paddingBottom: 36,
      paddingHorizontal: 8,
    },
    title: { fontSize: 12, color: colors.textMuted, paddingVertical: 10, paddingHorizontal: 12, textAlign: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12 },
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

export default ActionMenu;
