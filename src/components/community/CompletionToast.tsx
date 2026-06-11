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
 *
 * Reduced motion (UX-04 fix): when the OS "Reduce Motion" setting is on, the
 * vertical slide is suppressed — the toast appears at its resting position and
 * only cross-fades (and still cross-fades out). The screen-reader announcement
 * is unchanged either way. We read `AccessibilityInfo.isReduceMotionEnabled()`
 * on mount and subscribe to the `reduceMotionChanged` event so a mid-session
 * settings change is honoured for the next toast.
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
  // Live mirror of the OS "Reduce Motion" setting. Kept in a ref so the enter
  // effect reads the latest value without itself depending on it (a toggle
  // mid-toast should not re-fire the entrance animation).
  const reduceMotion = useRef(false);
  const [, setReduceMotionTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    // Only re-render when the resolved/changed value actually differs from what
    // we already hold. The animation logic reads `reduceMotion.current` lazily
    // at fire time, so an unchanged value needs no render — and skipping the
    // no-op state update avoids a spurious post-unmount/after-assert update.
    const apply = (enabled: boolean) => {
      if (reduceMotion.current === enabled) return;
      reduceMotion.current = enabled;
      setReduceMotionTick((t) => t + 1);
    };
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!mounted) return;
      apply(enabled);
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (!mounted) return;
        apply(enabled);
      },
    );
    return () => {
      mounted = false;
      // RN >= 0.65 returns a subscription with `.remove()`.
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (state == null) return;
    setRendered(state);
    // Announce to screen readers — a toast is otherwise easy to miss. This is
    // unchanged by reduce-motion.
    AccessibilityInfo.announceForAccessibility(state.message);

    const motionReduced = reduceMotion.current;
    opacity.setValue(0);
    // With reduce-motion the toast sits at its resting position (no slide); the
    // only transition is the cross-fade. Otherwise it rises from +16.
    translateY.setValue(motionReduced ? 0 : 16);

    const enter = motionReduced
      ? Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_MS,
          useNativeDriver: true,
        })
      : Animated.parallel([
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
        ]);
    enter.start();

    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      // Exit is a plain cross-fade in both modes (no slide to suppress).
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
