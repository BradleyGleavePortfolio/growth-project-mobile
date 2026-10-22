/**
 * The hero's win line (spec #688 item 2, OD-2), where every change is a cross-fade (owner #167-1: "make sure it has
 * smooth fade in/out animations ... just make sure it doesnt instantly pop up a new one"): the 6 s turn, a re-read that
 * brings a new win or drops the one on screen, and the first win of the week over the empty line. The old fades out
 * while the new one fades in, together, so no frame is empty and nothing pops. Opacity only, on the native driver.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { forestPop, motion, typography } from '../../../theme/tokens';
import type { HomeWin } from './homeDay';

export const WIN_TURN_MS = 6000;
/** Screen-level motion stays at 300 ms or less (docs/QUIET_LUXURY_DOCTRINE.md section 5). */
export const WIN_FADE_MS = 300;

/**
 * Which win takes the hero: the next every 6 s while `n` > 1. `n` is 0 while the Home is not in front (LO C2), so
 * nothing turns off screen. With Reduce Motion or a screen reader on the line holds still (as m#688 built it), so a
 * screen reader never hears a turn; `still` says so once it is known, so the row can fit the one win it shows.
 */
export function useWinTurn(n: number) {
  const [turn, setTurn] = useState(0);
  const [still, setStill] = useState<boolean | null>(null); // null until known: no turn yet
  useEffect(() => {
    let live = true;
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()])
      .then(([rm, sr]) => { if (live) setStill(rm || sr); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (still !== false || n <= 1) return undefined;
    const t = setInterval(() => setTurn((x) => x + 1), WIN_TURN_MS);
    return () => clearInterval(t);
  }, [still, n]);
  return { turn, still: still === true };
}

/** `was` is what fades out, kept whole (a win, or null for the empty line with the words it had), so it still draws
 * when a re-read drops it. */
type Turn = { now: HomeWin | null; was?: { w: HomeWin | null; e?: React.ReactNode }; fade: Animated.Value };
type Role = 'now' | 'was' | null;
export type WinFade = { t: Turn; shown: HomeWin | null; empty: React.ReactNode };

/**
 * The fade's state, held by the screen rather than by the line, so it lives on when the hero above the line is drawn
 * anew (on the web the hero's element changes from a heading to a button when the first win lands).
 * `shown` null: no win to show, so the `empty` line instead. `live` false while the Home is not in front: a change then
 * lands at once, and a fade under way ends.
 */
export function useWinFade(shown: HomeWin | null, live: boolean, empty: React.ReactNode): WinFade {
  const [t, setT] = useState<Turn>(() => ({ now: shown, fade: new Animated.Value(1) }));
  const seen = useRef<React.ReactNode>(empty); // the empty line as last drawn: a leaving one keeps its words
  let cur = t;
  // A change starts a fresh fade at 0 in this same render, so its first frame is the old line, never the new one at full.
  if (t.now?.id !== shown?.id) {
    cur = { now: shown, was: live ? { w: t.now, e: t.now ? undefined : seen.current } : undefined, fade: new Animated.Value(live ? 0 : 1) };
    setT(cur);
  }
  if (!shown) seen.current = empty;
  useEffect(() => {
    if (!t.was) return undefined;
    if (!live) { t.fade.setValue(1); setT((x) => ({ ...x, was: undefined })); return undefined; }
    const run = Animated.timing(t.fade, { toValue: 1, duration: WIN_FADE_MS, easing: Easing.bezier(...motion.easing.smooth), useNativeDriver: true });
    run.start(({ finished }) => { if (finished) setT((x) => (x.fade === t.fade ? { ...x, was: undefined } : x)); });
    return () => run.stop();
  }, [t, live]);
  return { t: cur, shown, empty };
}

interface Props {
  /** The wins drawn in place, the ones not shown at no opacity, so the row is as tall as the tallest of them and nothing
   * under the hero moves on a turn: the newest three while they turn, only the shown one when nothing turns. */
  wins: HomeWin[];
  fade: WinFade;
  line: (w: HomeWin, testID?: string) => React.ReactNode;
}

export function WinTurn({ wins, fade: { t, shown, empty }, line }: Props) {
  const was = t.was;
  if (!shown && !was) return <>{empty}</>; // m#688's empty line, as it drew it
  const out = t.fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const flow = shown ? wins : [null];
  const role = (w: HomeWin | null): Role => (w?.id === shown?.id ? 'now' : was && w?.id === was.w?.id ? 'was' : null);
  const draw = (w: HomeWin | null, r: Role, i: number, gone = false) => {
    const op = r === 'now' ? t.fade : r === 'was' ? out : 0;
    // One dot on the first line: the shown win draws it, steady between two wins and fading in over the empty line; a
    // leaving win draws it only when the empty line comes next.
    const dot = r === 'now' ? (was && !was.w ? t.fade : 1) : r === 'was' && !shown ? out : 0;
    return (
      <View
        key={w?.id ?? ''} style={[s.layer, gone ? s.gone : i > 0 && s.over]}
        importantForAccessibility={r === 'now' ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={r !== 'now'}
      >
        {w ? (
          <View style={s.win}>
            <Animated.View style={[s.dot, { opacity: dot }]} />
            <Animated.View style={[s.text, { opacity: op }]}>{line(w, r ? `home-win-${w.id}` : undefined)}</Animated.View>
          </View>
        ) : <Animated.View style={{ opacity: op }}>{r === 'was' ? was?.e : empty}</Animated.View>}
      </View>
    );
  };
  // What leaves without a place of its own (a re-read dropped it from the newest three, or it is the empty line) draws
  // as one more layer out of the flow, so the row keeps its height, until its fade ends (LO/LS B1).
  const kept = !!was && flow.some((w) => w?.id === was.w?.id);
  return (
    <View style={s.stack}>
      {flow.map((w, i) => draw(w, role(w), i))}
      {was && !kept ? draw(was.w, 'was', 0, true) : null}
    </View>
  );
}

// The layers sit on one spot: a row of full-width layers, each after the first pulled back over the first.
const s = StyleSheet.create({
  stack: { flexDirection: 'row' },
  layer: { width: '100%' },
  over: { marginLeft: '-100%' },
  gone: { position: 'absolute', top: 0, left: 0 },
  win: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: (typography.body.lineHeight - 8) / 2, backgroundColor: forestPop.leaf },
  text: { flex: 1 },
});
