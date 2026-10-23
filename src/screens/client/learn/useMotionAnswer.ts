/** Reduce Motion for the course moments (c06 footer, c08 week page, c09 locked week): `null` until the OS answers, then the answer, kept live.
 * The shared useReducedMotion says `false` until its probe resolves, so a moment that mounts and animates at once would start a fade the client
 * turned off. A moment waits for this answer before any entrance, so Reduce Motion holds from the first frame. */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useMotionAnswer(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const set = (on: boolean) => { if (live) setReduced(on); };
    // A platform that cannot answer gets motion, as the shared hook does; the moment is never held back.
    AccessibilityInfo.isReduceMotionEnabled().then(set, () => set(false));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', set);
    return () => { live = false; sub?.remove?.(); };
  }, []);
  return reduced;
}
