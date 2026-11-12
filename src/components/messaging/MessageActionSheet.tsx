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
import React, { useLayoutEffect, useMemo, useCallback } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { radius, spacing, voiceShades, type SemanticTokens } from '../../theme/tokens';
import { authEpoch, onAuthEpochChange } from '../../services/accountBinding';

export interface MessageActionSheetProps {
  visible: boolean;
  messagePreview?: string;
  onReply: () => void;
  onCopy: () => void;
  onReport: () => void;
  onClose: () => void;
  /** When false, the Report action is hidden — used to suppress self-report
   *  on the user's own messages (Apple 1.2 says only foreign content is
   *  reportable). Defaults to true. */
  canReport?: boolean;
  /** When false, Reply is hidden. The legacy send routes reject a reply
   *  reference (messaging v2 carries replies), so the legacy thread hides
   *  Reply instead of sending a message that fails. Defaults to true. */
  canReply?: boolean;
  /** REFINE-950: 'roman' draws the in-app (Android) sheet as dm-menu P3 b05 draws it, for the Roman room only.
   *  The direct-message screens pass nothing and keep this sheet's own look. The iOS native sheet takes no style. */
  look?: 'roman';
}

export function MessageActionSheet({
  visible,
  messagePreview,
  onReply,
  onCopy,
  onReport,
  onClose,
  canReport = true,
  canReply = true,
  look,
}: MessageActionSheetProps): React.ReactElement | null {
  const { colors, semanticColors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const goal = useMemo(() => (look === 'roman' ? makeRomanStyles(colors, semanticColors) : null), [look, colors, semanticColors]);
  const iconColor = goal ? colors.primary : colors.textPrimary;

  // KT-13 (FIX-950R2): one iOS native sheet lives only as long as the open it was shown for.
  // ActionSheetIOS keeps its choice callback outside React until a tap or dismissActionSheet
  // (RCTActionSheetManager.mm), so the sheet is dismissed and its callback goes dead when
  // visible turns false, when this unmounts and when the sign-in changes (sign-out, session
  // expiry, another sign-in). A choice that arrives after that runs nothing. A layout effect,
  // so the callback is dead in the same commit that hides the open.
  useLayoutEffect(() => {
    if (!visible || Platform.OS !== 'ios') return;
    let live = true;
    const shownUnder = authEpoch();
    const end = (): boolean => {
      if (!live) return false;
      live = false;
      stopWatching();
      ActionSheetIOS.dismissActionSheet();
      return true;
    };
    // The parent still thinks the menu is open after a sign-in change, so it is told it closed.
    const stopWatching = onAuthEpochChange(() => {
      if (end()) onClose();
    });
    const keys: Array<'reply' | 'copy' | 'report'> = [
      ...(canReply ? (['reply'] as const) : []),
      'copy',
      ...(canReport ? (['report'] as const) : []),
    ];
    const labels = { reply: 'Reply', copy: 'Copy', report: 'Report Message' };
    const options = [...keys.map((k) => labels[k]), 'Cancel'];
    const cancelButtonIndex = keys.length;
    const destructiveButtonIndex = canReport ? keys.indexOf('report') : undefined;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
        destructiveButtonIndex,
        title: messagePreview ? truncate(messagePreview, 80) : undefined,
        userInterfaceStyle: 'light',
      },
      (idx) => {
        if (!live || authEpoch() !== shownUnder) return;
        live = false;
        stopWatching();
        onClose();
        const k = keys[idx];
        if (k === 'reply') onReply();
        else if (k === 'copy') onCopy();
        else if (k === 'report') onReport();
      },
    );
    return () => {
      end();
    };
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
      <Pressable style={goal ? [styles.backdrop, goal.backdrop] : styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu">
        <Pressable style={goal ? [styles.sheet, goal.sheet] : styles.sheet} onPress={() => undefined}>
          {goal ? <View style={goal.grab} testID="message-sheet-grab" /> : null}
          {messagePreview ? (
            <Text style={goal ? [styles.preview, goal.preview] : styles.preview} numberOfLines={2}>
              {messagePreview}
            </Text>
          ) : null}
          {canReply ? (
            <ActionRow icon="return-up-back-outline" label="Reply" onPress={handleReply} styles={styles} goal={goal} color={iconColor} iconSize={goal ? 22 : 20} />
          ) : null}
          <ActionRow icon="copy-outline" label="Copy" onPress={handleCopy} styles={styles} goal={goal} color={iconColor} iconSize={goal ? 22 : 20} />
          {canReport ? (
            // b05 draws its report row in ink with a forest flag; the direct-message sheet keeps its red.
            <ActionRow icon="flag-outline" label="Report Message" onPress={handleReport} styles={styles} goal={goal} color={goal ? iconColor : colors.error}
              destructive={!goal} iconSize={goal ? 22 : 20} />
          ) : null}
          <Pressable onPress={onClose} style={goal ? [styles.cancelRow, goal.cancelRow] : styles.cancelRow} accessibilityRole="button">
            <Text style={goal ? [styles.cancelText, goal.cancelText] : styles.cancelText}>Cancel</Text>
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
  goal: ReturnType<typeof makeRomanStyles> | null;
  color: string;
  destructive?: boolean;
  iconSize: number;
}

function ActionRow({ icon, label, onPress, styles, goal, color, destructive, iconSize }: ActionRowProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => (goal ? [styles.row, goal.row, pressed && styles.rowPressed] : [styles.row, pressed && styles.rowPressed])}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={iconSize} color={color} />
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

/**
 * REFINE-950: the Roman room's sheet, laid over the shared one, from dm-menu P3 b05 (2x rows read in
 * RomanRefine950.test.tsx): a bgSurface sheet with 24 pt top corners and a sageLine grab, the top line at the
 * 20 pt inset, 48 pt rows with 22 pt forest icons, Cancel a forest text row, the mockups' ink scrim.
 * Values from the space chat's hold sheet (SpaceMessageSheet, C6CHAT c04), which draws the same frame family.
 */
const makeRomanStyles = (colors: ThemeColors, sc: SemanticTokens) =>
  StyleSheet.create({
    backdrop: { backgroundColor: voiceShades.scrim },
    sheet: {
      backgroundColor: sc.bgSurface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
      paddingHorizontal: 20, paddingBottom: 34, // b05: 34 pt from Cancel's row to the sheet's foot
    },
    grab: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10, backgroundColor: sc.surface.sageLine },
    // Margins, not padding: the two-line cut then ends at the second line in every renderer.
    preview: { textAlign: 'left', paddingVertical: 0, paddingHorizontal: 0, marginBottom: spacing.sm },
    row: { minHeight: 48, paddingVertical: 0, paddingHorizontal: 0, gap: spacing.lg },
    cancelRow: {
      minHeight: 44, paddingVertical: 0, paddingHorizontal: 0, justifyContent: 'center', backgroundColor: 'transparent',
    },
    cancelText: { color: colors.primary },
  });

export default MessageActionSheet;
