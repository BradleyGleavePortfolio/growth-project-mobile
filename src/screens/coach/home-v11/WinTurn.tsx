/**
 * The hero's win line (spec #688 item 2, OD-2), where every change is a cross-fade (owner #167-1: "make sure it has
 * smooth fade in/out animations ... just make sure it doesnt instantly pop up a new one"): the 6 s turn, a re-read that
 * brings a new win or drops the one on screen, and the first win of the week over the empty line, at 130 % text too,
 * where the empty line fades out and no win line follows (#168-3 op 1). The old fades out while the new one fades in,
 * together, so no frame is empty and nothing pops. Opacity only, on the native driver. With Reduce Motion on, every
 * change lands at once (#168-3; docs/QUIET_LUXURY_DOCTRINE.md section 5).
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
 * `calm`: Reduce Motion is on, so no change of the line fades (#168-3).
 */
export function useWinTurn(n: number) {
  const [turn, setTurn] = useState(0);
  const [a11y, setA11y] = useState<{ rm: boolean; sr: boolean } | null>(null); // null until known: no turn yet
  useEffect(() => {
    let live = true;
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), AccessibilityInfo.isScreenReaderEnabled()])
      .then(([rm, sr]) => { if (live) setA11y({ rm, sr }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  const still = a11y ? a11y.rm || a11y.sr : null;
  useEffect(() => {
    if (still !== false || n <= 1) return undefined;
    const t = setInterval(() => setTurn((x) => x + 1), WIN_TURN_MS);
    return () => clearInterval(t);
  }, [still, n]);
  return { turn, still: still === true, calm: a11y?.rm === true };
}

/** What the line draws: a win, the empty line (`w` null, with the words it had when it leaves), or nothing ('off'). */
type Drawn = { k: string; w: HomeWin | null; e?: React.ReactNode };
type Turn = { now: Drawn; was?: Drawn; fade: Animated.Value };
type Role = 'now' | 'was' | null;
export type WinFade = { t: Turn; empty: React.ReactNode };

/**
 * The fade's state, held by the screen rather than by the line, so it lives on when the hero above the line is drawn
 * anew (on the web the hero's element changes from a heading to a button when the first win lands).
 * `line`: the win on screen, null for the `empty` line, undefined when no line is on screen (Loading, an error, no
 * clients, or a win at 130 % text). Only a line that was on screen fades out: what follows Loading or an error lands
 * at once, so a line never seen never shows (LO r2 B1). `live` false while the Home is not in front, or `calm`
 * (Reduce Motion): a change lands at once, and a fade under way ends.
 */
export function useWinFade(line: HomeWin | null | undefined, live: boolean, calm: boolean, empty: React.ReactNode): WinFade {
  const next: Drawn = { k: line === undefined ? 'off' : line === null ? 'empty' : line.id, w: line ?? null };
  const [t, setT] = useState<Turn>(() => ({ now: next, fade: new Animated.Value(1) }));
  const seen = useRef<React.ReactNode>(empty); // the empty line as last drawn: a leaving one keeps its words
  let cur = t;
  // A change starts a fresh fade at 0 in this same render, so its first frame is the old line, never the new one at full.
  if (t.now.k !== next.k) {
    const go = live && !calm && t.now.k !== 'off';
    cur = { now: next, was: go ? { ...t.now, e: t.now.w ? undefined : seen.current } : undefined, fade: new Animated.Value(go ? 0 : 1) };
    setT(cur);
  }
  if (line === null) seen.current = empty;
  useEffect(() => {
    if (!t.was) return undefined;
    if (!live || calm) { t.fade.setValue(1); setT((x) => ({ ...x, was: undefined })); return undefined; }
    const run = Animated.timing(t.fade, { toValue: 1, duration: WIN_FADE_MS, easing: Easing.bezier(...motion.easing.smooth), useNativeDriver: true });
    run.start(({ finished }) => { if (finished) setT((x) => (x.fade === t.fade ? { ...x, was: undefined } : x)); });
    return () => run.stop();
  }, [t, live, calm]);
  return { t: cur, empty };
}

interface Props {
  /** The wins drawn in place, the ones not shown at no opacity, so the row is as tall as the tallest of them and nothing
   * under the hero moves on a turn: the newest three while they turn, only the shown one when nothing turns. */
  wins: HomeWin[];
  fade: WinFade;
  line: (w: HomeWin, testID?: string) => React.ReactNode;
}

export function WinTurn({ wins, fade: { t, empty }, line }: Props) {
  const { now, was } = t;
  if (!was && !now.w) return now.k === 'empty' ? <>{empty}</> : null; // m#688's empty line, as it drew it, or no line
  const out = t.fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const flow = now.w ? wins : now.k === 'empty' ? [null] : [];
  const role = (w: HomeWin | null): Role => (w?.id === now.w?.id ? 'now' : was && w?.id === was.w?.id ? 'was' : null);
  const draw = (w: HomeWin | null, r: Role, i: number) => {
    const op = r === 'now' ? t.fade : r === 'was' ? out : 0;
    // One dot on the first line: the shown win draws it, steady between two wins and fading in over the empty line; a
    // leaving win draws it only when no win comes next.
    const dot = r === 'now' ? (was && !was.w ? t.fade : 1) : r === 'was' && !now.w ? out : 0;
    return (
      <View
        key={w?.id ?? ''} style={[s.layer, i > 0 && s.over]}
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
  // What leaves without a place of its own (a re-read dropped it from the newest three, the empty line, or the line
  // before a win at 130 % text) draws as one more layer on the same spot, in the flow, so the row holds the taller of
  // the old and new lines until its fade ends (LO/LS B1, LO r2 C1).
  const kept = !!was && flow.some((w) => w !== null && w.id === was.w?.id);
  return (
    <View style={s.stack}>
      {flow.map((w, i) => draw(w, role(w), i))}
      {was && !kept ? draw(was.w, 'was', flow.length) : null}
    </View>
  );
}

// The layers sit on one spot: a row of full-width layers, each after the first pulled back over the first.
const s = StyleSheet.create({
  stack: { flexDirection: 'row' },
  layer: { width: '100%' },
  over: { marginLeft: '-100%' },
  win: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: (typography.body.lineHeight - 8) / 2, backgroundColor: forestPop.leaf },
  text: { flex: 1 },
});
