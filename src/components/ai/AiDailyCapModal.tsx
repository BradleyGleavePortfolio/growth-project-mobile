/**
 * AiDailyCapModal: the one pop-up every AI surface shows when the person has
 * reached a daily AI limit (src/lib/ai/aiDailyCap.ts). Title is the owner's
 * words verbatim; the body gives the reset time in the person's local time and
 * what keeps working. One "OK" closes it; nothing else on the surface is
 * blocked, so a later message (including a crisis message, which the server
 * never caps) can still be sent.
 */
import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  AI_DAILY_CAP_DISMISS,
  AI_DAILY_CAP_TITLE,
  aiDailyCapBody,
  type AiDailyCap,
  type AiDailyCapAudience,
} from '../../lib/ai/aiDailyCap';
import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';

export interface AiDailyCapModalProps {
  /** The cap to show; null hides the pop-up. */
  cap: AiDailyCap | null;
  audience: AiDailyCapAudience;
  onClose: () => void;
  testID?: string;
}

export default function AiDailyCapModal({
  cap,
  audience,
  onClose,
  testID = 'ai-daily-cap',
}: AiDailyCapModalProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const body = cap ? aiDailyCapBody(cap, audience) : '';

  return (
    <Modal
      visible={cap != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={styles.backdrop}>
        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
            {AI_DAILY_CAP_TITLE}
          </Text>
          <Text style={styles.body} testID={`${testID}-body`}>
            {body}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={AI_DAILY_CAP_DISMISS}
            testID={`${testID}-ok`}
          >
            <Text style={styles.buttonLabel}>{AI_DAILY_CAP_DISMISS}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(10,10,9,0.55)',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      gap: 12,
    },
    title: {
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    button: {
      marginTop: 8,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    buttonLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textOnPrimary,
    },
  });
}
