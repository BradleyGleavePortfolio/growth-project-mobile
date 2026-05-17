import React from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.nudgeModalOverlay}>
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
      </View>
    </Modal>
  );
}
