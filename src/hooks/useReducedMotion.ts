/**
 * useReducedMotion — a small shared hook that mirrors the OS "Reduce Motion"
 * accessibility setting (UX motion parity). It reads
 * `AccessibilityInfo.isReduceMotionEnabled()` on mount and subscribes to the
 * `reduceMotionChanged` event so a mid-session settings change is honoured.
 *
 * This is the reusable form of the pattern already proven in
 * `components/community/CompletionToast.tsx`. Surfaces that animate (e.g. the
 * coach event create / manage modals) consume this to drop their entrance/exit
 * animation to `none` when the user has asked the system to reduce motion.
 *
 * Returns the current boolean. SSR/headless-safe default is `false` (no
 * reduction) until the async probe resolves.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduced(enabled);
    });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (mounted) setReduced(enabled);
      },
    );
    return () => {
      mounted = false;
      // RN >= 0.65 returns a subscription with `.remove()`.
      sub?.remove?.();
    };
  }, []);

  return reduced;
}
