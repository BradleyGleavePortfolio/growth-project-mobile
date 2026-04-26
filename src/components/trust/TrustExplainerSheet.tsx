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
  SafeAreaView,
} from 'react-native';
import HapticPressable from '../HapticPressable';
import { Colors } from '../../constants/colors';
import { Spacing, Radius } from '../../theme/index';
import { typography, shadows } from '../../theme/tokens';

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

      <SafeAreaView style={styles.safeArea} pointerEvents="box-none">
        <View style={styles.sheet}>
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
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: 12,
    paddingBottom: 32,
    ...shadows.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
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
    borderRadius: Radius.full,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dismissBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textOnPrimary,
    letterSpacing: 0.3,
  },
});
