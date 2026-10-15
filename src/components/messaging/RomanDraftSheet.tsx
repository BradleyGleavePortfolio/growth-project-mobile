import React, { useCallback, useEffect, useRef } from 'react';
import {
  AccessibilityInfo, Animated, Easing, findNodeHandle, Modal, PanResponder,
  Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { colors, lightTokens, radius, typography } from '../../theme/tokens';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import RomanAvatar from '../roman/RomanAvatar';
import type { RomanDraftContext } from './RomanDraftMark';

export function focusRomanControl(node: View | Text | null): void {
  const tag = node && findNodeHandle(node);
  if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
}

/** Same modal/backdrop pattern as MessageActionSheet, with the approved c06/k06 content. */
export function RomanDraftSheet({ context, onClose, onDismiss }: {
  context: RomanDraftContext;
  onClose: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const title = useRef<Text>(null);
  const closing = useRef(false);
  const motion = useCallback((toValue: number) => Animated.timing(progress, {
    toValue, duration: reduced ? 150 : 250,
    easing: Easing.out(Easing.exp), useNativeDriver: true,
  }), [progress, reduced]);

  useEffect(() => {
    const animation = motion(1);
    animation.start(({ finished }) => { if (finished) focusRomanControl(title.current); });
    return () => animation.stop();
  }, [motion]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    motion(0).start(({ finished }) => {
      if (!finished) return;
      onClose();
      if (Platform.OS !== 'ios') requestAnimationFrame(onDismiss);
    });
  }, [motion, onClose, onDismiss]);
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 40) close(); },
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} onDismiss={onDismiss}
      statusBarTranslucent onAccessibilityEscape={close}>
      <View style={styles.container} accessibilityViewIsModal>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <Pressable testID="roman-draft-scrim" style={styles.scrim} onPress={close}
            accessibilityRole="button" accessibilityLabel="OK" />
        </Animated.View>
        <Animated.View testID="roman-draft-sheet" style={[styles.sheet, {
          paddingBottom: Math.max(insets.bottom, 24),
          opacity: progress,
          transform: [{ translateY: reduced ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [520, 0] }) }],
        }]} onAccessibilityEscape={close}>
          <View style={styles.handleArea} {...swipe.panHandlers}>
            <View style={styles.handle} />
          </View>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.portrait}>
              <RomanAvatar crop="neutral" size={54} />
            </View>
            <Text ref={title} accessibilityRole="header" style={styles.title}>Drafted with Roman</Text>
            <Text style={styles.body}>{context.isSender
              ? `Roman wrote the first draft and you sent it. ${context.client} sees this mark on the message too.`
              : `Roman, the assistant in this app, wrote a first draft of this message for ${context.coach}. ${context.coach} chose to send it to you.`}</Text>
            <Text style={styles.body}>{context.isSender
              ? 'The mark stays if you changed the draft before sending.'
              : `Roman drafts for ${context.coach} only while you allow AI help. You can change this later in Settings > Privacy.`}</Text>
            <PrimaryButton label="OK" testID="roman-draft-ok" onPress={close} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  scrim: { flex: 1, backgroundColor: lightTokens.overlay },
  sheet: { maxHeight: '90%', backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  handleArea: { height: 32, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: radius.chip, backgroundColor: lightTokens.border },
  content: { paddingHorizontal: 24, paddingBottom: 6, gap: 16 },
  portrait: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.chip, borderColor: colors.romanAccent },
  title: { ...typography.h1, color: lightTokens.textPrimary },
  body: { ...typography.body, color: colors.charcoal },
});
