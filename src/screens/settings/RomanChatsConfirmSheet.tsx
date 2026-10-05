/**
 * Confirm sheet for deleting Roman conversations. Plain copy that says the
 * delete is permanent. For "delete all" the person must also type DELETE
 * (case-insensitive) before the destructive button is enabled.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { colors as tokenColors, withAlpha } from '../../theme/tokens';
import { ROMAN_CHATS_COPY } from './romanChatsCopy';

export interface RomanChatsConfirmSheetProps {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** When true, the person types DELETE to enable the confirm button. */
  typed?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export function typedConfirmMatches(text: string): boolean {
  return text.trim().toUpperCase() === ROMAN_CHATS_COPY.confirmAllWord;
}

export default function RomanChatsConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  typed = false,
  onConfirm,
  onCancel,
  testID = 'roman-chats-confirm',
}: RomanChatsConfirmSheetProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!visible) setText('');
  }, [visible]);
  const enabled = !typed || typedConfirmMatches(text);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} testID={testID}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.body}>{body}</Text>
          {typed ? (
            <>
              <Text style={styles.label} nativeID="roman-chats-confirm-type-label">
                {ROMAN_CHATS_COPY.confirmAllTypeLabel}
              </Text>
              <TextInput
                value={text}
                onChangeText={setText}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel={ROMAN_CHATS_COPY.confirmAllTypeLabel}
                accessibilityLabelledBy="roman-chats-confirm-type-label"
                style={styles.input}
                testID={`${testID}-input`}
              />
            </>
          ) : null}
          <HapticPressable
            intent="medium"
            onPress={enabled ? onConfirm : undefined}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            accessibilityState={{ disabled: !enabled }}
            style={[styles.danger, !enabled && styles.disabled]}
            testID={`${testID}-confirm`}
          >
            <Text style={styles.dangerText}>{confirmLabel}</Text>
          </HapticPressable>
          <HapticPressable
            intent="light"
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={ROMAN_CHATS_COPY.keep}
            style={styles.quiet}
            testID={`${testID}-cancel`}
          >
            <Text style={styles.quietText}>{ROMAN_CHATS_COPY.keep}</Text>
          </HapticPressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: withAlpha(tokenColors.ink, 0.4),
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      padding: 24,
      paddingBottom: 40,
      gap: 12,
    },
    title: { fontFamily: 'Inter_500Medium', fontSize: 17, color: colors.textPrimary },
    body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, color: colors.textPrimary },
    label: { fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.textSecondary },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingHorizontal: 12,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textPrimary,
    },
    danger: {
      minHeight: 44,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.error,
      paddingHorizontal: 16,
    },
    dangerText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textOnPrimary },
    quiet: {
      minHeight: 44,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
    },
    quietText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textPrimary },
    disabled: { opacity: 0.5 },
  });
}
