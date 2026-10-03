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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';
import { colors, radius, spacing, typography } from '../../../theme/tokens';
import { configFor } from '../../../api/wearablesConnectionsApi';
import {
  connectFailureMessage,
  ctaLabelFor,
  notSyncingHereCopy,
  type OnDeviceMessage,
} from './onDeviceCopy';
import {
  openHealthConnectPermissions,
  openHealthConnectStore,
} from '../../../services/health/onDeviceConnect';
import { signOut } from '../../../services/authActions';
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
import { currentAuthGeneration } from '../../../services/health/sessionFence';
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
  const [refreshRun, setRefreshRun] = useState(0);
  const [refreshStartedFor, setRefreshStartedFor] = useState(-1);
  /**
   * S14 round 3: what the refresh found, shown above the views instead of
   * being dropped silently (Opus B-317-5, Sol B-317-2):
   *   - notSyncing: connected on the server, but this phone holds no Connect
   *     for the signed-in person, so nothing is read here; Reconnect.
   *   - partial / failed: some or all new data did not come in; Try again.
   */
  const [notice, setNotice] = useState<
    | { kind: 'notSyncing' }
    | { kind: 'retry'; text: string; action: OnDeviceMessage['action']; cta?: string }
    | null
  >(null);
  const deviceName = deviceSource != null ? configFor(deviceSource).displayName : '';
  // C-317-a: a refresh that settles after this screen unmounted, after a
  // sign-out or account switch, or after a newer refresh started writes no
  // notice and refetches nothing.
  const mountedRef = useRef(true);
  const latestRunRef = useRef(-1);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (refreshStartedFor === refreshRun || deviceSource == null || !hasDeviceConnection) return;
    setRefreshStartedFor(refreshRun);
    setNotice(null);
    const run = refreshRun;
    latestRunRef.current = run;
    const generation = currentAuthGeneration();
    const current = () =>
      mountedRef.current && latestRunRef.current === run && currentAuthGeneration() === generation;
    refreshOnDevice(deviceSource, connections)
      .then((outcome) => {
        if (!current()) return;
        if (outcome.kind === 'imported') {
          invalidateWearables();
          if (!outcome.complete) {
            setNotice({
              kind: 'retry',
              text: `Some of your ${deviceName} data didn't come in this time. Tap Try again, or it continues the next time you open Health.`,
              action: 'resume',
            });
          }
        } else if (outcome.kind === 'not_authorized') {
          setNotice({ kind: 'notSyncing' });
        }
      })
      .catch((err: unknown) => {
        // C-317-b: the error's class name only, never its message or body.
        logger.warn('[wearables] on-device refresh failed', {
          error: err instanceof Error ? err.name : typeof err,
        });
        if (!current()) return;
        const message = connectFailureMessage(err, deviceName);
        if (message != null) {
          setNotice({ kind: 'retry', text: message.text, action: message.action, cta: message.cta });
        }
      });
  }, [
    refreshRun,
    refreshStartedFor,
    deviceSource,
    deviceName,
    hasDeviceConnection,
    connections,
    invalidateWearables,
  ]);

  const retryRefresh = useCallback(() => setRefreshRun((n) => n + 1), []);

  const goToConnections = useCallback(() => {
    navigation.navigate('Connections');
  }, [navigation]);

  /**
   * S-WEAR-3: the notice button does what its message says: Try again
   * re-runs the refresh, Log in again ends the expired session, Open Health
   * Connect / Get Health Connect open the place the copy names.
   */
  const runNoticeAction = useCallback(
    (action: OnDeviceMessage['action']) => {
      if (action === 'login') {
        void signOut();
        return;
      }
      if (action === 'open_settings') {
        void openHealthConnectPermissions();
        return;
      }
      if (action === 'open_store') {
        void openHealthConnectStore();
        return;
      }
      if (action === 'connect') {
        // Connect has to run again (for example, the connection is no
        // longer linked to this account): open Connections.
        goToConnections();
        return;
      }
      retryRefresh();
    },
    [retryRefresh, goToConnections],
  );


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

      {notice != null && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>
            {notice.kind === 'notSyncing' ? notSyncingHereCopy(deviceName) : notice.text}
          </Text>
          {(notice.kind === 'notSyncing' || notice.action !== 'none') && (
          <Pressable
            style={styles.noticeAction}
            onPress={
              notice.kind === 'notSyncing'
                ? goToConnections
                : () => runNoticeAction(notice.action)
            }
            accessibilityRole="button"
            accessibilityLabel={
              notice.kind === 'notSyncing'
                ? `Reconnect ${deviceName}`
                : notice.action === 'resume'
                  ? `Try again to sync ${deviceName}`
                  : notice.action === 'connect'
                    ? `Reconnect ${deviceName}`
                    : ctaLabelFor({ action: notice.action, cta: notice.cta })
            }
          >
            <Text style={styles.noticeActionText}>
              {notice.kind === 'notSyncing'
                ? 'Reconnect'
                : notice.action === 'resume'
                  ? 'Try again'
                  : notice.action === 'connect'
                    ? 'Reconnect'
                    : ctaLabelFor({ action: notice.action, cta: notice.cta })}
            </Text>
          </Pressable>
          )}
        </View>
      )}

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
  notice: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
  },
  noticeText: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
  noticeAction: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  noticeActionText: {
    ...typography.bodyMd,
    color: colors.forest,
  },
});
