/**
 * CompletionToast — the designed confirmation moment for v1-6 coach community
 * mutations (G11 / design-doctrine AP-4 "Empty Confirmation" fix).
 *
 * The original lane completed create-cohort / invite / hide by simply letting a
 * row appear or a modal close — no designed success moment. This component is
 * the shared confirmation primitive: a brief success-styled toast that slides
 * up from the bottom, holds, then fades out. It is self-contained (local
 * `Animated` state, no global store) and driven through the `useCompletionToast`
 * hook so a screen can fire it imperatively from a mutation `onSuccess`.
 *
 * Copy rules (Roman voice register): a short, declarative confirmation with no
 * exclamation point and no emoji (e.g. "Cohort created.", "Invite sent.",
 * "Hidden."). The caller supplies the message; this component owns only the
 * timing + motion + success styling.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radius, semantic } from '../../theme/tokens';

const VISIBLE_MS = 2200;
const FADE_MS = 220;

export interface CompletionToastState {
  message: string;
  /** Monotonically increasing key so re-firing the same message re-triggers. */
  key: number;
}

export interface UseCompletionToast {
  /** The current toast state to pass to <CompletionToast state={...} />. */
  toast: CompletionToastState | null;
  /** Fire a success toast with the given confirmation message. */
  show: (message: string) => void;
}

/**
 * Imperative trigger for the completion toast. A screen calls `show("Hidden.")`
 * from a mutation `onSuccess` and renders `<CompletionToast state={toast} />`.
 */
export function useCompletionToast(): UseCompletionToast {
  const [toast, setToast] = useState<CompletionToastState | null>(null);
  const seq = useRef(0);
  const show = useCallback((message: string) => {
    seq.current += 1;
    setToast({ message, key: seq.current });
  }, []);
  return { toast, show };
}

export interface CompletionToastProps {
  /** The current toast state from `useCompletionToast`. `null` renders nothing. */
  state: CompletionToastState | null;
  testID?: string;
}

export default function CompletionToast({
  state,
  testID,
}: CompletionToastProps): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const [rendered, setRendered] = useState<CompletionToastState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state == null) return;
    setRendered(state);
    // Announce to screen readers — a toast is otherwise easy to miss.
    AccessibilityInfo.announceForAccessibility(state.message);
    opacity.setValue(0);
    translateY.setValue(16);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
    ]).start();

    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(null);
      });
    }, VISIBLE_MS);

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // Re-run whenever a new toast is fired (state identity changes per `key`).
  }, [state, opacity, translateY]);

  if (rendered == null) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID={testID ?? 'coach-completion-toast'}
      style={[
        styles.toast,
        {
          bottom: insets.bottom + spacing.xl,
          backgroundColor: semantic.success.bg,
          borderColor: semantic.success.border,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={[styles.text, { color: semantic.success.fg }]}>
        {rendered.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
