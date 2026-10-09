/**
 * TrustExplainerSheet — UX Psychology Report #2: Trust as Emotion
 *
 * Bottom-sheet modal with a title + one paragraph of context-specific copy
 * for each trust cue chip. Dismiss with button or backdrop tap.
 */

import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HapticPressable from '../HapticPressable';
import { Colors } from '../../constants/colors';
import { Spacing } from '../../theme/index';
import { radius, typography, shadows } from '../../theme/tokens';

export interface TrustExplainerContent {
  title: string;
  body: string;
}

interface Props {
  visible: boolean;
  content: TrustExplainerContent | null;
  onDismiss: () => void;
}

export default function TrustExplainerSheet({ visible, content, onDismiss }: Props) {
  if (!content) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      {/* Backdrop tap to dismiss */}
      <TouchableWithoutFeedback onPress={onDismiss} accessibilityLabel="Dismiss">
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <View style={styles.safeArea} pointerEvents="box-none">
        {/* The sheet runs to the screen edge; its padding clears the gesture bar. */}
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handle} />

          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>

          <HapticPressable
            intent="light"
            style={styles.dismissBtn}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Got it, dismiss"
          >
            <Text style={styles.dismissBtnText}>Got it</Text>
          </HapticPressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: 32,
    ...shadows.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.chip,
    backgroundColor: Colors.border,
    marginBottom: 20,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: Colors.textSecondary,
    marginBottom: 28,
  },
  dismissBtn: {
    backgroundColor: Colors.primary,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dismissBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textOnPrimary,
    letterSpacing: 0.3,
  },
});
