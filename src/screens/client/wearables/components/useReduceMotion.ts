/**
 * useReduceMotion — one shared accessibility hook for the wearables surface.
 *
 * Reads `AccessibilityInfo.isReduceMotionEnabled()` on mount and subscribes to
 * runtime changes, mirroring the repo's existing pattern (see
 * `src/components/FadeInView.tsx`). Centralising it here means every animated
 * wearables surface — the shell cross-fade, the three-ring stroke, the glow
 * chart spring — reads the SAME source of truth and degrades to instant /
 * glow-off in lock-step.
 *
 * Defaults to `false` (motion ON) before the async probe resolves; the probe
 * is fast and an 800ms ring animation that the user didn't want for one frame
 * is acceptable, whereas defaulting to `true` would suppress motion for every
 * user during the probe.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {
        // A platform that can't answer the probe (e.g. older web shim) is
        // treated as "motion allowed" — we do NOT silently suppress motion for
        // everyone on such platforms. This is an explicit, documented fallback,
        // not a swallowed error (#36): the only failure mode is "the probe
        // can't tell us", and the safe-for-most default is motion-on.
        if (!cancelled) setReduceMotion(false);
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (!cancelled) setReduceMotion(enabled);
      },
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
