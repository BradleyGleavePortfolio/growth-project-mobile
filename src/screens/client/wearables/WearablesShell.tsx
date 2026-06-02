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
 *   - Fitness → <HealthFitnessScreen/> (owned by HK-3a).
 *   - Recovery → <SleepRecoveryScreen/> (owned by HK-3b). The screen owns its
 *     own connect/empty/error states (its EmptyState renders the value-first
 *     "connect a sleep source" prompt — Bradley LAW §0.1 — so the connect
 *     surface lives there, not in the shell; no placeholder surface remains).
 *
 * The shell is a navigation screen mounted as `Health` in ClientNavigator with
 * an optional `{ bucket?: 'fitness' | 'recovery' }` param.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';
import { colors, spacing } from '../../../theme/tokens';
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
import ClientWearableInsightPanel from './ClientWearableInsightPanel';
import HealthFitnessScreen from './HealthFitnessScreen';
import SleepRecoveryScreen from './SleepRecoveryScreen';

type HealthRouteParams = { bucket?: 'fitness' | 'recovery' };

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

  // Each bucket screen renders the client AI insight panel in its `aiPanelSlot`
  // (the read-only HK-5b surface — no approve/dismiss; that is coach-only, HK-6).
  const content =
    bucket === 'HEALTH_FITNESS' ? (
      <HealthFitnessScreen
        aiPanelSlot={<ClientWearableInsightPanel bucket="HEALTH_FITNESS" />}
      />
    ) : (
      <SleepRecoveryScreen
        bucketParam={paramForBucket(bucket)}
        aiPanelSlot={<ClientWearableInsightPanel bucket="SLEEP_RECOVERY" />}
      />
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
});
