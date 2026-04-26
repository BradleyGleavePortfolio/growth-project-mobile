/**
 * FirstWinCelebration — Psych Report #1 "Activation-First Dopamine"
 *
 * Full-screen overlay that fires on the user's very first log/workout.
 * Built with the React Native Animated API only (no new deps required):
 *   - 20 confetti particles rain from above
 *   - Identity title animates in
 *   - Dismisses after 2.5 s or on tap
 *
 * Props:
 *   visible       — show/hide the overlay
 *   identityTitle — e.g. "Athlete", "Nutrition Pro", "Explorer"
 *   onDismiss     — called when overlay should be hidden
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableWithoutFeedback,
  Dimensions,
} from 'react-native';
import { Colors } from '../constants/colors';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Confetti particle config ──────────────────────────────────────────────

const PARTICLE_COUNT = 22;
const CONFETTI_COLORS = [
  '#FFD700', // gold
  '#52B788', // brand green
  '#E76F51', // terra-cotta
  '#457B9D', // steel blue
  '#E9C46A', // amber
  '#B5E8D0', // pale green
  '#FF6B6B', // coral
];

interface Particle {
  x: Animated.Value;
  y: Animated.Value;
  rotate: Animated.Value;
  opacity: Animated.Value;
  color: string;
  size: number;
  startX: number;
}

function useParticles(): Particle[] {
  return useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        x: new Animated.Value(0),
        y: new Animated.Value(0),
        rotate: new Animated.Value(0),
        opacity: new Animated.Value(1),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 8 + Math.random() * 8,
        startX: (SCREEN_W / PARTICLE_COUNT) * i + Math.random() * (SCREEN_W / PARTICLE_COUNT),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  identityTitle: string;
  onDismiss: () => void;
}

export default function FirstWinCelebration({ visible, identityTitle, onDismiss }: Props) {
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.7)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const particles = useParticles();

  useEffect(() => {
    if (!visible) return;

    // ── Overlay fade in ────────────────────────────────────────────────────
    Animated.timing(overlayOpacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();

    // ── Card pop in ────────────────────────────────────────────────────────
    Animated.parallel([
      Animated.spring(cardScale, {
        toValue: 1,
        tension: 120,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // ── Confetti burst ─────────────────────────────────────────────────────
    particles.forEach((p, i) => {
      p.x.setValue(0);
      p.y.setValue(0);
      p.rotate.setValue(0);
      p.opacity.setValue(1);

      const delay = i * 40;
      const fallDist = SCREEN_H * 0.55 + Math.random() * SCREEN_H * 0.25;
      const driftX = (Math.random() - 0.5) * 160;

      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(p.y, {
            toValue: fallDist,
            duration: 1800 + Math.random() * 500,
            useNativeDriver: true,
          }),
          Animated.timing(p.x, {
            toValue: driftX,
            duration: 1800 + Math.random() * 500,
            useNativeDriver: true,
          }),
          Animated.timing(p.rotate, {
            toValue: (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 5),
            duration: 1800 + Math.random() * 500,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(900 + Math.random() * 400),
            Animated.timing(p.opacity, {
              toValue: 0,
              duration: 600,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
    });

    // ── Auto-dismiss after 2.8 s ───────────────────────────────────────────
    const timer = setTimeout(() => {
      dismiss();
    }, 2800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  };

  if (!visible) return null;

  return (
    <TouchableWithoutFeedback onPress={dismiss} accessible={false}>
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        {/* Confetti particles */}
        {particles.map((p, i) => {
          const rotate = p.rotate.interpolate({
            inputRange: [-10, 10],
            outputRange: ['-360deg', '360deg'],
          });
          return (
            <Animated.View
              key={i}
              style={[
                styles.particle,
                {
                  left: p.startX,
                  top: -20,
                  width: p.size,
                  height: p.size * (Math.random() > 0.4 ? 0.45 : 1),
                  borderRadius: Math.random() > 0.4 ? 2 : p.size / 2,
                  backgroundColor: p.color,
                  opacity: p.opacity,
                  transform: [
                    { translateX: p.x },
                    { translateY: p.y },
                    { rotate },
                  ],
                },
              ]}
            />
          );
        })}

        {/* Identity card */}
        <Animated.View
          style={[
            styles.card,
            { opacity: cardOpacity, transform: [{ scale: cardScale }] },
          ]}
        >
          
          <Text style={styles.winTitle}>First Win Locked In</Text>
          <View style={styles.identityBadge}>
            <Text style={styles.identityLabel}>Identity</Text>
            <Text style={styles.identityValue}>{identityTitle}</Text>
          </View>
          <Text style={styles.welcomeText}>Welcome to the inner circle.</Text>
          <Text style={styles.tapText}>Tap to continue</Text>
        </Animated.View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  particle: {
    position: 'absolute',
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    paddingVertical: 40,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginHorizontal: 32,
    width: SCREEN_W - 64,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    gap: 8,
  },
  trophy: {
    fontSize: 56,
    marginBottom: 4,
  },
  winTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  identityBadge: {
    backgroundColor: 'rgba(45, 106, 79, 0.10)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 28,
    alignItems: 'center',
    marginVertical: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  identityLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  identityValue: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.primary,
    letterSpacing: -0.3,
  },
  welcomeText: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 4,
  },
  tapText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 12,
  },
});
