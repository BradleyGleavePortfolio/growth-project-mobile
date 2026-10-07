/**
 * HealthFitnessEmptyState — the value-first empty state for the Fitness
 * Overview (brief §4.5).
 *
 * Bradley LAW (§0.3): this is the SKELETON OF THE REAL LAYOUT, not a spinner
 * and not "Coming soon". It renders three activity bars with absent values
 * above a value-first prompt and a "Connect a tracker" CTA
 * that routes to the existing ConnectionsScreen. The user sees what the screen
 * WILL look like once a source is connected — the most motivating possible
 * empty state.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  radius,
  spacing,
  typography,
} from '../../../../theme/tokens';
import { type BucketTone } from '../wearablesTheme';
import { useTheme } from '../../../../theme/useTheme';
import ActivityBars from '../cards/ActivityBars';
import type { ActivityTargets } from '../starterGoals';

interface Props {
  readonly targets?: ActivityTargets;
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
  return `Connect ${store} to import activity, heart rate, workouts and body measurements.`;
}

export default function HealthFitnessEmptyState({
  onConnect,
  targets,
}: Props) {
  const { semanticColors: sc } = useTheme();

  return (
    <View style={styles.container}>
      <ActivityBars targets={targets} />

      {onConnect == null ? (
        <>
          <Text style={[styles.title, { color: sc.textPrimary }]}>No health data from this client yet</Text>
          <Text style={[styles.body, { color: sc.textMuted }]}>
            When your client connects Apple Health or Health Connect in the app, their activity,
            heart rate and workouts show here.
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: sc.textPrimary }]}>See your fitness in one place</Text>
          <Text style={[styles.body, { color: sc.textMuted }]}>{connectBody()}</Text>
        </>
      )}

      {onConnect != null && (
        <Pressable
          onPress={onConnect}
          accessibilityRole="button"
          accessibilityLabel="Connect a tracker"
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: sc.accent },
            pressed && styles.ctaPressed,
          ]}
        >
          <Ionicons name="add-circle-outline" size={18} color={sc.textOnAccent} />
          <Text style={[styles.ctaText, { color: sc.textOnAccent }]}>Connect a tracker</Text>
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
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  body: {
    ...typography.body,
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
    minHeight: 44,
    marginTop: spacing.xl,
  },
  ctaPressed: {
    opacity: 0.9,
  },
  ctaText: {
    ...typography.bodyMd,
  },
});
