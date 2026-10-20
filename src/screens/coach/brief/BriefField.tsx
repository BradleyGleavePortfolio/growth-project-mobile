/**
 * BriefField: Concept A's room. A deep forest field (D-A1, D-A2) with a cream and gold glow rising from the bottom edge
 * and two faint gold arcs (D-A3, D-A7). Decorative only. The glow lights with the reveal (`lit`) and breathes on a 6 s
 * loop (opacity 0.9 to 1.0, D-A5) unless `still`; the loop stops in the background.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, AppState, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../../../theme/tokens';

const ROOM = [[0, '#111612'], [0.08, '#162119'], [0.17, '#1E3125'], [0.27, '#263F2F'], [0.4, colors.forest]] as const;
const GLOW = [
  [0, '#FBF7F0', 0.97], [0.18, colors.cream, 0.9], [0.36, '#DEC896', 0.66],
  [0.54, colors.romanAccent, 0.34], [0.7, colors.camel, 0.12], [0.86, colors.forest, 0],
] as const;

export default function BriefField({ lit, still }: { lit: Animated.AnimatedInterpolation<number>; still: boolean }) {
  const { width: w, height: h } = useWindowDimensions();
  const breath = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    breath.setValue(1);
    if (still) return undefined;
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 0.9, duration: 3000, easing: ease, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 3000, easing: ease, useNativeDriver: true }),
      ]),
    );
    const sync = (s: string) => (s === 'active' ? loop.start() : loop.stop());
    sync(AppState.currentState);
    const sub = AppState.addEventListener('change', sync);
    return () => {
      sub.remove();
      loop.stop();
    };
  }, [breath, still]);

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="brief-field"
    >
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id="room" x1="0" y1="0" x2="0" y2="1">
            {ROOM.map(([o, c]) => <Stop key={o} offset={o} stopColor={c} />)}
          </LinearGradient>
        </Defs>
        <Rect width={w} height={h} fill="url(#room)" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(lit, breath) }]}>
        <Svg width={w} height={h}>
          <Defs>
            <RadialGradient id="pool" cx="50%" cy="50%" r="50%">
              {GLOW.map(([o, c, a]) => <Stop key={o} offset={o} stopColor={c} stopOpacity={a} />)}
            </RadialGradient>
            <RadialGradient id="core" cx="50%" cy="50%" r="50%">
              <Stop offset={0} stopColor="#FFFCF6" stopOpacity={0.95} />
              <Stop offset={0.45} stopColor="#FBF7F0" stopOpacity={0.55} />
              <Stop offset={1} stopColor="#FBF7F0" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={w / 2} cy={h * 1.06} rx={w * 1.35} ry={h * 0.4} fill="url(#pool)" />
          <Ellipse cx={w / 2} cy={h * 1.01} rx={w * 0.7} ry={h * 0.16} fill="url(#core)" />
          <Ellipse cx={w / 2} cy={h} rx={260} ry={150} fill="none" stroke={colors.romanAccent} strokeOpacity={0.28} />
          <Ellipse cx={w / 2} cy={h + 5} rx={340} ry={200} fill="none" stroke={colors.romanAccent} strokeOpacity={0.14} />
        </Svg>
      </Animated.View>
    </View>
  );
}
