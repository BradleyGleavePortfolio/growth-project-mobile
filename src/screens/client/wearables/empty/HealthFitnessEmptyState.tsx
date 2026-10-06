/**
 * HealthFitnessEmptyState — the value-first empty state for the Fitness
 * Overview (brief §4.5).
 *
 * Bradley LAW (§0.3): this is the SKELETON OF THE REAL LAYOUT, not a spinner
 * and not "Coming soon". It renders the actual three-ring hero at 0% (real
 * rings, just empty) above a value-first prompt and a "Connect a tracker" CTA
 * that routes to the existing ConnectionsScreen. The user sees what the screen
 * WILL look like once a source is connected — the most motivating possible
 * empty state.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../../../../theme/tokens';
import { toneTokens, type BucketTone } from '../wearablesTheme';
import ThreeRingHero, { type RingDatum } from '../cards/ThreeRingHero';

interface Props {
  readonly tone: BucketTone;
  readonly reduceMotion: boolean;
  /**
   * Opens Connections. AUDIT-11-125: omitted in the coach embed (a coach's
   * client view has no Connections route), which then shows coach copy and no
   * button.
   */
  readonly onConnect?: () => void;
}

/**
 * AUDIT-11-125: name only what this phone can connect. Cloud trackers are not
 * switched on for launch, so "Garmin, Fitbit or any tracker" was not true.
 */
function connectBody(): string {
  const store = Platform.OS === 'android' ? 'Health Connect' : 'Apple Health';
  return `Connect ${store} to fill your rings and watch your heart, workouts and body trends come to life.`;
}

export default function HealthFitnessEmptyState({
  tone,
  reduceMotion,
  onConnect,
}: Props) {
  const toneTk = toneTokens(tone);

  // Real ring shells at 0% — the empty hero. Colors are the warm H&F triad.
  const emptyRings: readonly [RingDatum, RingDatum, RingDatum] = [
    { progress: 0, color: colors.camel, label: 'Move' },
    { progress: 0, color: colors.mutedGold, label: 'Exercise' },
    { progress: 0, color: colors.forest, label: 'Stand' },
  ];

  return (
    <View style={styles.container}>
      <ThreeRingHero
        rings={emptyRings}
        centerValue="—"
        centerLabel="Active kcal"
        tone={tone}
        reduceMotion={reduceMotion}
        empty
      />

      {onConnect == null ? (
        <>
          <Text style={styles.title}>No health data from this client yet</Text>
          <Text style={styles.body}>
            When your client connects Apple Health or Health Connect in the app, their activity,
            heart rate and workouts show here.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>See your fitness in one place</Text>
          <Text style={styles.body}>{connectBody()}</Text>
        </>
      )}

      {onConnect != null && (
        <Pressable
          onPress={onConnect}
          accessibilityRole="button"
          accessibilityLabel="Connect a tracker"
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: toneTk.accent },
            pressed && styles.ctaPressed,
          ]}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.bone} />
          <Text style={styles.ctaText}>Connect a tracker</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  title: {
    ...typography.h2,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  body: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
    marginTop: spacing.xl,
  },
  ctaPressed: {
    opacity: 0.9,
  },
  ctaText: {
    ...typography.bodyMd,
    color: colors.bone,
  },
});
