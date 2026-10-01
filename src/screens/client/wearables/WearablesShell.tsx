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
import {
  useInvalidateWearableConnections,
  useWearableConnections,
} from '../../../hooks/useWearableConnections';
import { featureFlags } from '../../../config/featureFlags';
import {
  deviceSourceForPlatform,
  refreshOnDevice,
} from '../../../services/health/onDeviceSync';
import { logger } from '../../../utils/logger';
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
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const invalidateWearables = useInvalidateWearableConnections();

  // S14: refresh on open. A remote "connected" row is NOT enough to read this
  // phone's health store (A-317-1): refreshOnDevice runs only when the
  // signed-in person tapped Connect on THIS phone (local authorization keyed
  // by user + source) and the server still lists that same connection. It
  // reads what is new since that account's progress, posts it behind a
  // session fence, then the views refetch. Once per mount; failures are
  // logged and the views keep showing what is already stored.
  const deviceSource = deviceSourceForPlatform();
  const hasDeviceConnection = connections.some(
    (c) => c.provider === deviceSource && c.status === 'connected',
  );
  const [refreshStarted, setRefreshStarted] = useState(false);
  useEffect(() => {
    if (refreshStarted || deviceSource == null || !hasDeviceConnection) return;
    setRefreshStarted(true);
    refreshOnDevice(deviceSource, connections)
      .then((outcome) => {
        if (outcome.kind === 'imported') invalidateWearables();
      })
      .catch((err: unknown) => {
        logger.warn('[wearables] on-device refresh failed', err);
      });
  }, [refreshStarted, deviceSource, hasDeviceConnection, connections, invalidateWearables]);

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

  // Each bucket screen can render the client AI insight panel in its
  // `aiPanelSlot` (the read-only HK-5b surface — no approve/dismiss; that is
  // coach-only, HK-6). S14: only behind `wearableAiInsights` (default OFF)
  // until the panel honours the D2 AI-processing consent.
  const aiPanelsOn = featureFlags.wearableAiInsights;
  const content =
    bucket === 'HEALTH_FITNESS' ? (
      <HealthFitnessScreen
        aiPanelSlot={
          aiPanelsOn ? <ClientWearableInsightPanel bucket="HEALTH_FITNESS" /> : undefined
        }
      />
    ) : (
      <SleepRecoveryScreen
        bucketParam={paramForBucket(bucket)}
        aiPanelSlot={
          aiPanelsOn ? <ClientWearableInsightPanel bucket="SLEEP_RECOVERY" /> : undefined
        }
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
