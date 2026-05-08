/**
 * BloodworkDisclaimerModal — acknowledgement-required disclaimer gate.
 *
 * MUST fire on first entry to any bloodwork surface, per user, per device.
 * The user cannot proceed to bloodwork data until they tap "I understand".
 *
 * Privacy doctrine:
 *   - Acknowledgement is stored in expo-secure-store, keyed by userId.
 *   - The screen is NOT bypassable — if acknowledgement fails to save,
 *     the modal remains visible and an error message is shown.
 *   - Copy is plain English (readable by a 15-year-old).
 *   - No emoji.
 *
 * BEFORE PUBLIC LAUNCH: Final wording must be reviewed by Bradley's
 * lawyer. See src/screens/bloodwork/README.md § "Before Public Launch".
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import HapticPressable from './HapticPressable';
import { useTheme, ThemeColors } from '../theme/ThemeProvider';
import {
  BLOODWORK_DISCLAIMER_LONG,
  BLOODWORK_DISCLAIMER_MODAL_TITLE,
  BLOODWORK_DISCLAIMER_MODAL_BULLETS,
  BLOODWORK_DISCLAIMER_ACK_BUTTON,
} from '../constants/bloodworkCopy';
import { recordDisclaimerAcknowledgement } from '../lib/bloodworkDisclaimerHelper';

interface BloodworkDisclaimerModalProps {
  visible: boolean;
  userId: string;
  onAcknowledged: () => void;
}

export default function BloodworkDisclaimerModal({
  visible,
  userId,
  onAcknowledged,
}: BloodworkDisclaimerModalProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAcknowledge = async () => {
    setSaving(true);
    setError(null);
    try {
      await recordDisclaimerAcknowledgement(userId);
      onAcknowledged();
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : 'Could not save your acknowledgement. Please try again.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      presentationStyle="pageSheet"
      accessibilityViewIsModal
    >
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          accessibilityLabel="Bloodwork disclaimer"
        >
          <Text style={styles.title}>{BLOODWORK_DISCLAIMER_MODAL_TITLE}</Text>

          <Text style={styles.body}>{BLOODWORK_DISCLAIMER_LONG}</Text>

          <View style={styles.bulletBlock}>
            {BLOODWORK_DISCLAIMER_MODAL_BULLETS.map((bullet: string, i: number) => (
              <View key={i} style={styles.bulletRow}>
                <Text style={styles.bulletDot} accessibilityElementsHidden>
                  {'\u2013'}
                </Text>
                <Text style={styles.bulletText}>{bullet}</Text>
              </View>
            ))}
          </View>

          {error ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel={BLOODWORK_DISCLAIMER_ACK_BUTTON}
            onPress={handleAcknowledge}
            disabled={saving}
            style={[styles.ackBtn, saving && styles.ackBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.ackBtnText}>{BLOODWORK_DISCLAIMER_ACK_BUTTON}</Text>
            )}
          </HapticPressable>

          <Text style={styles.footnote}>
            You can review this notice again at any time in Settings.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 24, paddingBottom: 40 },
    title: {
      fontSize: 22,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 16,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    bulletBlock: {
      marginBottom: 24,
    },
    bulletRow: {
      flexDirection: 'row',
      marginBottom: 8,
      gap: 8,
    },
    bulletDot: {
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    bulletText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    errorText: {
      fontSize: 14,
      color: colors.error,
      marginBottom: 12,
    },
    ackBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 16,
    },
    ackBtnDisabled: {
      opacity: 0.6,
    },
    ackBtnText: {
      color: colors.textOnPrimary,
      fontSize: 16,
      fontWeight: '500',
    },
    footnote: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
}
