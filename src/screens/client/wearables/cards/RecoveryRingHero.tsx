/**
 * RecoveryRingHero — the SINGLE recovery-ring hero for the S&R bucket
 * (NOT three rings — that's H&F's ThreeRingHero). One large ring driven by
 * RECOVERY_SCORE (READINESS_SCORE fallback). Centre shows today's recovery
 * percent + a PLAIN-LANGUAGE summary ("Recovered" / "Recovering" / "Run-down")
 * — the number is never shown without its label (UX gate §5.2 / brief §4).
 *
 * Colour (Bradley LAW): a low score desaturates toward slate — NEVER red.
 * The ring animates its stroke on mount via the JS Animated API
 * (useNativeDriver where possible; the SVG stroke uses a JS-driven value with a
 * single interpolation, not per-frame setState — #11 performance). Reduce-motion
 * snaps the ring to its final position.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { RECOVERY_PALETTE, resolveRecoveryState } from '../recoveryTheme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface RecoveryRingHeroProps {
  /** 0-100 recovery score, or null when there is no data yet. */
  score: number | null;
  colors: ThemeColors;
  /** Ring diameter in px. Hero sizes this to ~35% viewport height upstream. */
  size?: number;
  testID?: string;
}

export function RecoveryRingHero({ score, colors, size = 220, testID }: RecoveryRingHeroProps) {
  const stateView = resolveRecoveryState(score);
  const ringColor = stateView.color(RECOVERY_PALETTE);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const strokeWidth = Math.max(12, Math.round(size * 0.07));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;

  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (v) => !cancelled && setReduceMotion(v),
      () => !cancelled && setReduceMotion(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      progress.setValue(pct);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: pct,
      duration: 800,
      // SVG strokeDashoffset can't use the native driver; JS-driven single value.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [pct, reduceMotion, progress]);

  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const centerNumber = score === null ? '—' : `${score}`;

  return (
    <View style={styles.wrap} testID={testID ?? 'recovery-ring-hero'}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* Track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={RECOVERY_PALETTE.track}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress arc — cool indigo / desaturated slate, never red */}
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
            // Start the arc at 12 o'clock.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={[styles.percent, { color: colors.textPrimary }]} testID="recovery-percent">
            {centerNumber}
            {score !== null ? <Text style={styles.percentUnit}>%</Text> : null}
          </Text>
          {/* Plain-language label — the number is NEVER shown without this. */}
          <Text style={[styles.stateLabel, { color: ringColor }]} testID="recovery-state-label">
            {stateView.label}
          </Text>
        </View>
      </View>
    </View>
  );
}

function makeStyles(_colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { alignItems: 'center', justifyContent: 'center' },
    center: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    percent: { fontSize: 52, fontWeight: '600', letterSpacing: -1 },
    percentUnit: { fontSize: 22, fontWeight: '600' },
    stateLabel: { fontSize: 15, fontWeight: '600', marginTop: 2, letterSpacing: 0.4 },
  });
}

export default RecoveryRingHero;
