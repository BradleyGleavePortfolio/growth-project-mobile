/**
 * ThreeRingHero — the Apple-Watch-style three-ring hero at the top of the
 * Fitness Overview (brief §4.3).
 *
 * Three concentric rings map to:
 *   - Move     → active energy (kcal) vs goal
 *   - Exercise → workout duration (min) vs goal
 *   - Stand    → steps vs goal
 *
 * Rings animate their stroke on mount (800ms ease-out worklet). When
 * `reduceMotion` is on, rings render at their final value instantly (no
 * animation) — they are NEVER hidden.
 *
 * Bradley LAW (§0.3 / §4.3): when there is NO data, we do NOT render
 * "Coming soon" or a static placeholder image. We render the rings at 0% with
 * a value-first prompt inviting the user to connect a tracker. The rings are
 * real, just empty — the screen looks like itself, only un-filled.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors, typography, withAlpha } from '../../../../theme/tokens';
import { toneTokens, type BucketTone } from '../wearablesTheme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface RingDatum {
  /** 0..1 progress (value / goal), clamped by the component. */
  readonly progress: number;
  readonly color: string;
  readonly label: string;
}

export interface ThreeRingHeroProps {
  /** Outer → inner. Exactly three rings (Move / Exercise / Stand). */
  readonly rings: readonly [RingDatum, RingDatum, RingDatum];
  /** Headline number rendered in the ring center (e.g. active kcal today). */
  readonly centerValue: string;
  readonly centerLabel: string;
  readonly tone: BucketTone;
  readonly reduceMotion: boolean;
  /** When true, show the value-first "connect a tracker" prompt above. */
  readonly empty: boolean;
}

const SIZE = 168;
const STROKE = 14;
const GAP = 6;

interface AnimatedRingProps {
  readonly radius: number;
  readonly color: string;
  readonly progress: number;
  readonly reduceMotion: boolean;
}

function AnimatedRing({ radius, color, progress, reduceMotion }: AnimatedRingProps) {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const anim = useSharedValue(reduceMotion ? clamped : 0);

  useEffect(() => {
    if (reduceMotion) {
      anim.value = clamped;
      return;
    }
    anim.value = withTiming(clamped, {
      duration: 800,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [clamped, reduceMotion, anim]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - anim.value),
  }));

  const center = SIZE / 2;

  return (
    <>
      {/* Track */}
      <Circle
        cx={center}
        cy={center}
        r={radius}
        stroke={withAlpha(color, 0.16)}
        strokeWidth={STROKE}
        fill="none"
      />
      {/* Progress */}
      <AnimatedCircle
        cx={center}
        cy={center}
        r={radius}
        stroke={color}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        animatedProps={animatedProps}
        // Start the arc at 12 o'clock.
        transform={`rotate(-90 ${center} ${center})`}
      />
    </>
  );
}

export default function ThreeRingHero({
  rings,
  centerValue,
  centerLabel,
  tone,
  reduceMotion,
  empty,
}: ThreeRingHeroProps) {
  const toneTk = toneTokens(tone);
  const radii = [
    SIZE / 2 - STROKE / 2 - 2,
    SIZE / 2 - STROKE / 2 - STROKE - GAP - 2,
    SIZE / 2 - STROKE / 2 - (STROKE + GAP) * 2 - 2,
  ];

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      {empty && (
        <Text style={styles.prompt} accessibilityRole="text">
          Connect Apple Health or another tracker to fill your rings.
        </Text>
      )}

      <View
        style={styles.ringWrap}
        accessibilityLabel={
          empty
            ? 'Activity rings, no data yet'
            : `${rings
                .map((r) => `${r.label} ${Math.round(r.progress * 100)} percent`)
                .join(', ')}`
        }
      >
        <Svg width={SIZE} height={SIZE}>
          {rings.map((ring, i) => (
            <AnimatedRing
              key={ring.label}
              radius={radii[i]}
              color={ring.color}
              progress={ring.progress}
              reduceMotion={reduceMotion}
            />
          ))}
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={[styles.centerValue, { color: toneTk.accent }]}>
            {centerValue}
          </Text>
          <Text style={styles.centerLabel}>{centerLabel}</Text>
        </View>
      </View>

      <View style={styles.legend}>
        {rings.map((ring) => (
          <View key={ring.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: ring.color }]} />
            <Text style={styles.legendLabel}>{ring.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  prompt: {
    ...typography.bodySmall,
    color: colors.charcoal,
    textAlign: 'center',
    marginBottom: 12,
    maxWidth: 280,
  },
  ringWrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerValue: {
    ...typography.h2,
    fontFamily: 'CormorantGaramond_500Medium',
  },
  centerLabel: {
    ...typography.caption,
    color: colors.charcoal,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    ...typography.caption,
    color: colors.charcoal,
    textTransform: 'none',
    letterSpacing: 0.2,
  },
});
