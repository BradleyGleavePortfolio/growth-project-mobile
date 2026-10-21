import React, { useContext } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';

export function NudgeModal({
  visible,
  onClose,
  clientName,
  nudgeTitle,
  setNudgeTitle,
  nudgeBody,
  setNudgeBody,
  nudgeError,
  nudgeSending,
  onSend,
  colors,
  styles,
}: {
  visible: boolean;
  onClose: () => void;
  clientName: string;
  nudgeTitle: string;
  setNudgeTitle: (s: string) => void;
  nudgeBody: string;
  setNudgeBody: (s: string) => void;
  nudgeError: string;
  nudgeSending: boolean;
  onSend: () => void;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  // The card centres below the status bar, so a long message never pushes its title under the clock.
  const topInset = useContext(SafeAreaInsetsContext)?.top ?? 0;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The form sits above the keyboard, so Send and Cancel stay reachable while typing (as LogPlannedMealButton). */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.nudgeModalOverlay, { paddingTop: topInset }]}>
        <View style={styles.nudgeModalContent}>
          <Text style={styles.nudgeModalTitle}>Send Nudge</Text>
          <Text style={styles.nudgeModalDesc}>
            Send a push-style notification to {clientName}.
          </Text>

          <Text style={styles.nudgeLabel}>Title</Text>
          <TextInput
            style={styles.nudgeInput}
            placeholder="e.g. Great job today"
            placeholderTextColor={colors.textMuted}
            value={nudgeTitle}
            onChangeText={setNudgeTitle}
            maxLength={80}
            accessibilityLabel="Nudge title"
          />

          <Text style={styles.nudgeLabel}>Message</Text>
          <TextInput
            style={[styles.nudgeInput, styles.nudgeInputMulti]}
            placeholder="Write a short message..."
            placeholderTextColor={colors.textMuted}
            value={nudgeBody}
            onChangeText={setNudgeBody}
            multiline
            maxLength={500}
            accessibilityLabel="Nudge message"
          />

          {nudgeError ? (
            <Text style={styles.nudgeErrorText} accessibilityLiveRegion="assertive">
              {nudgeError}
            </Text>
          ) : null}

          <View style={styles.nudgeButtons}>
            <TouchableOpacity
              style={styles.nudgeCancelBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.nudgeCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nudgeSendBtn, nudgeSending && { opacity: 0.6 }]}
              onPress={onSend}
              disabled={nudgeSending}
              accessibilityRole="button"
              accessibilityLabel="Send nudge"
            >
              <Text style={styles.nudgeSendText}>{nudgeSending ? 'Sending…' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
