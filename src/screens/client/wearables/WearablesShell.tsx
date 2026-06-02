/**
 * WearablesShell — the parent surface for the wearables buckets (brief §3b).
 *
 * Owns:
 *   - the `Fitness | Recovery` segmented switcher (BucketSwitcher),
 *   - the freshness chip (top-right, derived from connections — plan line 91),
 *   - the 200ms warm↔cool cross-fade between buckets (§1.4), which collapses to
 *     an instant swap when the OS reduce-motion setting is on, and
 *   - the `?bucket=` route param (defaults to `fitness`).
 *
 * Mounting:
 *   - Fitness → <HealthFitnessScreen/> (owned by THIS PR).
 *   - Recovery → the Sleep & Recovery surface. HK-3b owns SleepRecoveryScreen
 *     and, on merge, swaps the single `renderRecovery()` branch below to mount
 *     it (a tight, additive one-line change — this file is otherwise frozen for
 *     HK-3b per the brief). Until then the Recovery bucket renders a real,
 *     value-first connect surface (NOT a "Coming soon" placeholder — Bradley
 *     LAW §0.1): a genuine prompt to connect a sleep/recovery source, which is
 *     the accurate state for a user with no recovery data yet.
 *
 * The shell is a navigation screen mounted as `Health` in ClientNavigator with
 * an optional `{ bucket?: 'fitness' | 'recovery' }` param.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../../../theme/tokens';
import type { WearableMetricBucket } from '../../../api/wearablesSamplesApi';
import { useWearableConnections } from '../../../hooks/useWearableConnections';
import { useReduceMotion } from './components/useReduceMotion';
import {
  SHELL_CROSSFADE_MS,
  bucketForParam,
  paramForBucket,
} from './wearablesTheme';
import BucketSwitcher from './components/BucketSwitcher';
import FreshnessChip from './components/FreshnessChip';
import HealthFitnessScreen from './HealthFitnessScreen';

type HealthRouteParams = { bucket?: 'fitness' | 'recovery' };

/**
 * The Recovery bucket placeholder rendered until HK-3b mounts the dedicated
 * SleepRecoveryScreen here. This is a real, value-first connect surface — it
 * accurately reflects "no recovery source connected yet" and routes to the
 * Connections hub. It is NOT a "Coming soon" gate.
 */
function RecoveryConnectSurface({ onConnect }: { onConnect: () => void }) {
  return (
    <View style={styles.recoveryWrap}>
      <View style={styles.recoveryIcon}>
        <Ionicons name="moon-outline" size={28} color={colors.forest} />
      </View>
      <Text style={styles.recoveryTitle}>See your recovery</Text>
      <Text style={styles.recoveryBody}>
        Connect a sleep or recovery source — like Oura, Whoop, or Apple Health —
        to track sleep, HRV, and readiness here.
      </Text>
      <Pressable
        onPress={onConnect}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.recoveryCta,
          pressed && styles.recoveryCtaPressed,
        ]}
      >
        <Text style={styles.recoveryCtaText}>Connect a source</Text>
      </Pressable>
    </View>
  );
}

export default function WearablesShell() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<Record<string, HealthRouteParams>, string>>();
  const reduceMotion = useReduceMotion();

  const initialBucket = bucketForParam(route.params?.bucket);
  const [bucket, setBucket] = useState<WearableMetricBucket>(initialBucket);

  // Cross-fade opacity (1 = settled). On reduce-motion we never animate.
  const fade = useMemo(() => new Animated.Value(1), []);

  const connectionsQuery = useWearableConnections();
  const connections = connectionsQuery.data ?? [];

  const goToConnections = useCallback(() => {
    navigation.navigate('Connections');
  }, [navigation]);

  const handleSwitch = useCallback(
    (next: WearableMetricBucket) => {
      if (next === bucket) return;
      // Keep the route param in sync so deep-links / back-stack restore the
      // last-viewed bucket without re-mounting the shell.
      navigation.setParams({ bucket: paramForBucket(next) } as never);

      if (reduceMotion) {
        setBucket(next);
        return;
      }
      // 200ms warm↔cool cross-fade: fade current out, swap, fade new in.
      Animated.timing(fade, {
        toValue: 0,
        duration: SHELL_CROSSFADE_MS / 2,
        useNativeDriver: true,
      }).start(() => {
        setBucket(next);
        Animated.timing(fade, {
          toValue: 1,
          duration: SHELL_CROSSFADE_MS / 2,
          useNativeDriver: true,
        }).start();
      });
    },
    [bucket, fade, navigation, reduceMotion],
  );

  // External param changes (deep-link while mounted) sync into local state.
  useEffect(() => {
    const fromParam = bucketForParam(route.params?.bucket);
    setBucket((prev: WearableMetricBucket) => (prev === fromParam ? prev : fromParam));
  }, [route.params?.bucket]);

  const content =
    bucket === 'HEALTH_FITNESS' ? (
      <HealthFitnessScreen />
    ) : (
      <RecoveryConnectSurface onConnect={goToConnections} />
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <BucketSwitcher active={bucket} onChange={handleSwitch} />
        <FreshnessChip
          connections={connections}
          bucket={bucket}
          onPress={goToConnections}
        />
      </View>

      <Animated.View
        style={[styles.body, reduceMotion ? undefined : { opacity: fade }]}
      >
        {content}
      </Animated.View>
    </SafeAreaView>
  );
}

/** Exposed for the shell unit tests (bucket → switcher label). */
export function providerLabel(bucket: WearableMetricBucket): string {
  return bucket === 'HEALTH_FITNESS' ? 'Fitness' : 'Recovery';
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  body: {
    flex: 1,
  },
  recoveryWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  recoveryIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  recoveryTitle: {
    ...typography.h3,
    color: colors.ink,
    textAlign: 'center',
  },
  recoveryBody: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
    maxWidth: 320,
  },
  recoveryCta: {
    marginTop: spacing.sm,
    backgroundColor: colors.forest,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
  },
  recoveryCtaPressed: {
    opacity: 0.85,
  },
  recoveryCtaText: {
    ...typography.bodyMd,
    color: colors.bone,
    fontFamily: 'Inter_600SemiBold',
  },
});
