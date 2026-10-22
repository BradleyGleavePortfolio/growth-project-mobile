/**
 * The hero's one win in turn (spec #688 item 2, OD-2), as a cross-fade (owner #167-1: "make sure it has smooth fade
 * in/out animations ... just make sure it doesnt instantly pop up a new one"). The old win fades out while the new one
 * fades in, together, so no frame is empty and nothing pops. Opacity only, on the native driver.
 */
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { motion } from '../../../theme/tokens';
import type { HomeWin } from './homeDay';

export const WIN_TURN_MS = 6000;
/** Screen-level motion stays at 300 ms or less (docs/QUIET_LUXURY_DOCTRINE.md section 5). */
export const WIN_FADE_MS = 300;

/**
 * Which win takes the hero: the next every 6 s while `n` > 1. `n` is 0 while the Home is not in front (LO C2), so
 * nothing turns off screen. With Reduce Motion or a screen reader on the line holds still (as m#688 built it), so a
 * screen reader never hears a turn.
 */
export function useWinTurn(n: number) {
  const [turn, setTurn] = useState(0);
  const [still, setStill] = useState(true);
  useEffect(() => {
    let live = true;
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()])
      .then(([rm, sr]) => { if (live) setStill(rm || sr); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (still || n <= 1) return undefined;
    const t = setInterval(() => setTurn((x) => x + 1), WIN_TURN_MS);
    return () => clearInterval(t);
  }, [still, n]);
  return turn;
}

interface Props {
  /** The newest three wins. Every one is drawn, the ones not shown at no opacity, so the row is as tall as the
   * tallest and nothing under the hero moves when a two-line win follows a one-line one. */
  wins: HomeWin[];
  shown: HomeWin;
  /** false while the Home is not in front: a change then lands at once, and a fade under way ends. */
  live: boolean;
  line: (w: HomeWin, testID?: string) => React.ReactNode;
}

type Turn = { now: string; was: string | null; fade: Animated.Value };

export function WinTurn({ wins, shown, live, line }: Props) {
  const [t, setT] = useState<Turn>(() => ({ now: shown.id, was: null, fade: new Animated.Value(1) }));
  // A new win starts a fresh fade at 0 in this same render, so its first frame is the old win, never the new one at full.
  if (t.now !== shown.id) setT({ now: shown.id, was: live ? t.now : null, fade: new Animated.Value(live ? 0 : 1) });
  useEffect(() => {
    if (t.was === null) return undefined;
    if (!live) { t.fade.setValue(1); setT((x) => ({ ...x, was: null })); return undefined; }
    const run = Animated.timing(t.fade, { toValue: 1, duration: WIN_FADE_MS, easing: Easing.bezier(...motion.easing.smooth), useNativeDriver: true });
    run.start(({ finished }) => { if (finished) setT((x) => (x.fade === t.fade ? { ...x, was: null } : x)); });
    return () => run.stop();
  }, [t, live]);
  const out = t.fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <View style={s.stack}>
      {wins.map((w, i) => {
        const role = w.id === t.now ? 'now' : w.id === t.was ? 'was' : null;
        return (
          <Animated.View
            key={w.id} style={[s.layer, i > 0 && s.over, { opacity: role === 'now' ? t.fade : role === 'was' ? out : 0 }]}
            importantForAccessibility={role === 'now' ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={role !== 'now'}
          >
            {line(w, role ? `home-win-${w.id}` : undefined)}
          </Animated.View>
        );
      })}
    </View>
  );
}

// The layers sit on one spot: a row of full-width layers, each after the first pulled back over the first.
const s = StyleSheet.create({
  stack: { flex: 1, flexDirection: 'row' },
  layer: { width: '100%' },
  over: { marginLeft: '-100%' },
});
