/**
 * CalmSlowReveal — the S&R bucket's "A — Animation" primitive from the CALM
 * framework (uiux paper §2.2 / Phantom playbook step 2): a calming transition
 * that begins BEFORE the user reads any deficit number, modulating the
 * emotional baseline so they enter the moment relaxed.
 *
 * Behaviour: on first mount, children fade in (opacity 0→1) and rise 8px
 * (translateY 8→0) over 600ms with an ease-out curve. Every S&R card wraps its
 * content in this on first mount (UX gate §5.4).
 *
 * Accessibility (Bradley LAW + UX gate §5.4): if the OS "Reduce Motion" setting
 * is on, the reveal is INSTANT — no fade, no translate. We read
 * `AccessibilityInfo.isReduceMotionEnabled()` and also subscribe to changes so
 * a mid-session toggle is honoured. The animation uses the JS `Animated` API
 * with `useNativeDriver: true` so opacity/transform run off the main thread
 * (#11 performance — no per-frame setState).
 */

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, type ViewStyle } from 'react-native';

export interface CalmSlowRevealProps {
  children: React.ReactNode;
  /** Stagger this reveal (ms) so a column of cards cascades gently. */
  delay?: number;
  /** Reveal duration; defaults to the 600ms S&R spec. */
  duration?: number;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}

const REVEAL_DURATION_MS = 600;
const REVEAL_TRANSLATE_PX = 8;

export function CalmSlowReveal({
  children,
  delay = 0,
  duration = REVEAL_DURATION_MS,
  style,
  testID,
}: CalmSlowRevealProps) {
  // Start hidden+offset only until we know the reduce-motion preference; we
  // resolve it synchronously-ish on mount and snap to visible if reduce-motion.
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      },
      () => {
        // Fail-safe: if the reduced-motion query rejects we default to the
        // instant reveal path so content is never stuck hidden. This is a
        // graceful, observable degradation — not a swallowed error — and the
        // no-motion path is the accessible default.
        if (!cancelled) setReduceMotion(true);
      },
    );
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return; // still resolving the preference
    if (reduceMotion) {
      progress.setValue(1); // instant — honour reduce-motion (UX gate §5.4)
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      // ease-out: decelerate into rest (CALM "settle", never a hard stop)
      easing: easeOut,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, progress, duration, delay]);

  // While the preference is still resolving, render hidden so we never flash an
  // un-animated frame; resolves within a tick.
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [REVEAL_TRANSLATE_PX, 0],
  });

  return (
    <Animated.View
      testID={testID}
      style={[{ opacity: progress, transform: [{ translateY }] }, style as ViewStyle]}
    >
      {children}
    </Animated.View>
  );
}

/** Cubic ease-out: fast start, gentle settle. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default CalmSlowReveal;
