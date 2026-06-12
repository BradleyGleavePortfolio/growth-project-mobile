/**
 * ParticleBurst — a one-shot radial particle burst for the ED.3 First Payment
 * Wow Screen (spec §2.6, "THE moment").
 *
 * TECH CHOICE — pure react-native-reanimated (NOT Skia):
 *   `@shopify/react-native-skia` is NOT in this repo's dependencies (verified
 *   in package.json). Per the builder brief's fallback rule ("If
 *   @shopify/react-native-skia is in deps, prefer Skia … Otherwise pure
 *   Reanimated"), each particle is an absolutely-positioned <Animated.View>
 *   driven by a single shared `progress` value on the UI thread via
 *   `useAnimatedStyle`. No per-frame setState, no JS round-trip per particle —
 *   the whole burst is one timing curve interpolated 28 ways. This matches the
 *   repo's established Reanimated-on-UI-thread pattern (RevolutGlowChart) and
 *   avoids adding a heavyweight native graphics dependency for one screen.
 *
 * Each particle is given a deterministic-per-mount random angle / distance /
 * size at construction, then animates from the screen centre outward, fading
 * to zero opacity and scale at the edge of its travel. The burst fires once on
 * mount and does not loop (this is a celebration beat, not an ambient effect).
 *
 * Reduce-motion (#50 graceful degradation): when `reduceMotion` is true the
 * particles are not rendered at all — the screen still carries the moment
 * through Roman's copy and mascot, with no motion.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
  type SharedValue,
} from 'react-native-reanimated';
import { colors } from '../../theme/tokens';

export interface ParticleBurstProps {
  /** Number of particles to emit. Brief asks for 20-40; default 28. */
  readonly count?: number;
  /** Total burst duration in ms (each particle varies slightly around this). */
  readonly durationMs?: number;
  /** When true, render nothing (no motion) — accessibility / reduce-motion. */
  readonly reduceMotion?: boolean;
  readonly testID?: string;
}

interface ParticleSpec {
  readonly angle: number; // radians
  readonly distance: number; // px of travel from centre
  readonly size: number; // px diameter
  readonly delay: number; // ms stagger
  readonly color: string;
}

const DEFAULT_COUNT = 28;
const DEFAULT_DURATION = 1400;

/** Deep-gold celebration palette, drawn from design tokens (no raw hex). */
const PARTICLE_COLORS = [colors.romanAccent, colors.mutedGold, colors.forest];

/**
 * Build the per-particle specs once per mount. `seed` is the particle index so
 * the spread is even-ish around the circle while still looking organic.
 */
function buildParticles(count: number, radius: number): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    // Even base angle around the circle + a small per-particle jitter so the
    // burst is radial but not a rigid starburst.
    const base = (i / count) * Math.PI * 2;
    const jitter = (pseudoRandom(i * 2 + 1) - 0.5) * (Math.PI / count);
    const angle = base + jitter;
    const distance = radius * (0.55 + pseudoRandom(i * 3 + 2) * 0.45);
    const size = 6 + pseudoRandom(i * 5 + 3) * 10;
    const delay = pseudoRandom(i * 7 + 4) * 120;
    const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
    out.push({ angle, distance, size, delay, color });
  }
  return out;
}

/**
 * Deterministic pseudo-random in [0,1) from an integer seed. Deterministic so
 * the burst is stable within a mount (and reproducible in tests) without
 * pulling in a PRNG dependency. Not used for anything security-sensitive.
 */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function Particle({
  spec,
  progress,
}: {
  spec: ParticleSpec;
  progress: SharedValue<number>;
}): React.ReactElement {
  const style = useAnimatedStyle(() => {
    // Stagger each particle by its delay across the [0,1] progress window.
    const dx = Math.cos(spec.angle) * spec.distance;
    const dy = Math.sin(spec.angle) * spec.distance;
    const p = progress.value;
    const translateX = interpolate(p, [0, 1], [0, dx]);
    const translateY = interpolate(p, [0, 1], [0, dy]);
    // Fade in fast, fade out toward the edge; scale up then collapse.
    const opacity = interpolate(p, [0, 0.12, 0.7, 1], [0, 1, 0.8, 0]);
    const scale = interpolate(p, [0, 0.2, 1], [0.2, 1, 0.4]);
    return {
      opacity,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          backgroundColor: spec.color,
        },
        style,
      ]}
    />
  );
}

export default function ParticleBurst({
  count = DEFAULT_COUNT,
  durationMs = DEFAULT_DURATION,
  reduceMotion = false,
  testID,
}: ParticleBurstProps): React.ReactElement | null {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const radius = Math.max(width, height) * 0.5;

  const particles = useMemo(
    () => buildParticles(count, radius),
    [count, radius],
  );

  React.useEffect(() => {
    if (reduceMotion) return;
    // One-shot burst on mount. easeOut so particles fling out then settle.
    progress.value = withTiming(1, {
      duration: durationMs,
      easing: Easing.out(Easing.cubic),
    });
  }, [reduceMotion, durationMs, progress]);

  if (reduceMotion) return null;

  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={styles.container}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {particles.map((spec, i) => (
        <Particle key={i} spec={spec} progress={progress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
  },
});
