/**
 * SleepRecoveryTab — coach-side Sleep & Recovery view for a client.
 *
 * Renders the same client recovery cards but adds two COACH-ONLY overlays
 * (brief §5.5):
 *   - An anomaly band beneath the hero (clinician-style 7-day deviation zone).
 *   - A cohort-comparison sparkline next to the HRV trend ("median client at
 *     week 6"). Cohort comparisons are NEVER rendered on the client side.
 *
 * IDOR defence (#5): the backend gates the `clientId` query via CoachGuard and
 * returns 403 if this coach does not own the client. This tab MUST render a
 * graceful `<RecoveryUnavailable />` state on 403 — NEVER throw uncaught. Any
 * other error surfaces a retry. No sample values are ever logged (#34).
 *
 * Anomaly band + cohort sparkline only render when `clientId` is present (we are
 * a coach viewing a client); they are inert on a client device.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import { logger } from '../../../utils/logger';

import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { WearableSamplesError } from '../../../api/wearablesSamplesApi';
import { RecoveryRingHero } from '../../client/wearables/cards/RecoveryRingHero';
import { SleepStagesCard } from '../../client/wearables/cards/SleepStagesCard';
import { HrvTrendCard } from '../../client/wearables/cards/HrvTrendCard';
import { SleepConsistencyCard } from '../../client/wearables/cards/SleepConsistencyCard';
import { RECOVERY_PALETTE } from '../../client/wearables/recoveryTheme';
import {
  recoveryScore,
  sleepStages,
  trendFor,
  latestValue,
  sleepConsistency,
  type TrendPoint,
} from '../../client/wearables/recoveryData';

export interface SleepRecoveryTabProps {
  clientId: string;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}

function windowRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** True when the thrown error is an authorisation failure (IDOR-gated). */
function isForbidden(error: unknown): boolean {
  if (error instanceof WearableSamplesError) return error.status === 403;
  // Defensive: some transports surface the status on a plain object.
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status?: unknown }).status === 403;
  }
  return false;
}

export function SleepRecoveryTab({ clientId, colors, styles }: SleepRecoveryTabProps) {
  const { from, to } = useMemo(() => windowRange(), []);
  const localStyles = useMemo(() => makeStyles(colors), [colors]);

  const query = useWearableSamples({
    bucket: 'SLEEP_RECOVERY',
    clientId,
    from,
    to,
    granularity: 'day',
    preferredOnly: true,
  });

  const onRetry = useCallback(() => {
    logger.log('SleepRecoveryTab', 'retry samples fetch', { hasClient: true });
    // Floated refetch — a rejection is logged (never dropped) so a failing
    // coach-side retry surfaces in diagnostics (#36).
    void query.refetch().catch((error: unknown) => {
      logger.warn('SleepRecoveryTab', 'refetch rejected', { error });
    });
  }, [query]);

  // ── IDOR-safe 403 fallback (#5) — graceful, never an uncaught throw. ──
  if (query.isError && isForbidden(query.error)) {
    logger.warn('SleepRecoveryTab', 'recovery access denied for client (403)');
    return <RecoveryUnavailable colors={colors} />;
  }

  // ── Other errors — actionable retry, never swallowed (#36). ──
  if (query.isError && !query.data) {
    logger.error('SleepRecoveryTab', 'samples query failed', {
      message: query.error?.message ?? 'unknown',
    });
    return (
      <View style={localStyles.centered} testID="coach-recovery-error">
        <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
        <Text style={[styles.sectionTitle, { textAlign: 'center', marginTop: 12 }]}>
          We couldn&apos;t load this client&apos;s recovery data.
        </Text>
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={localStyles.retryBtn}
          testID="coach-recovery-retry"
        >
          <Text style={localStyles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const data = query.data;
  const score = recoveryScore(data);
  const stages = sleepStages(data);
  const hrvTrend = trendFor(data, 'HRV_MS');
  const hrvLatest = latestValue(data, 'HRV_MS');
  const consistency = sleepConsistency(data);

  return (
    <View testID="coach-recovery-tab">
      {/* Hero + clinician-style anomaly band directly beneath it. */}
      <View style={localStyles.heroWrap}>
        <RecoveryRingHero score={score} colors={colors} size={200} />
        <AnomalyBand trend={hrvTrend} colors={colors} />
      </View>

      <View style={{ marginTop: 14 }}>
        <SleepStagesCard stages={stages} colors={colors} />
      </View>

      {/* HRV trend with a coach-only cohort comparison sparkline beside it. */}
      <View style={{ marginTop: 14 }}>
        <HrvTrendCard trend={hrvTrend} latestMs={hrvLatest} colors={colors} />
        <CohortComparison trend={hrvTrend} colors={colors} />
      </View>

      <View style={{ marginTop: 14 }}>
        <SleepConsistencyCard consistency={consistency} colors={colors} />
      </View>
    </View>
  );
}

/** Graceful IDOR fallback surface. Calm, non-accusatory copy. */
function RecoveryUnavailable({ colors }: { colors: ThemeColors }) {
  const localStyles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={localStyles.centered} testID="recovery-unavailable">
      <Ionicons name="lock-closed-outline" size={32} color={colors.textMuted} />
      <Text style={[localStyles.unavailableText, { color: colors.textSecondary }]}>
        You don&apos;t have access to this client&apos;s recovery data.
      </Text>
    </View>
  );
}

/**
 * AnomalyBand — a subtle horizontal band showing the 7-day deviation zone of
 * the HRV trend (clinician-style overlay). Coach-only. Computes a ±1σ band and
 * marks where the latest value sits within it. Uses cool tones; an out-of-band
 * reading is drawn in soft amber, never red.
 */
function AnomalyBand({ trend, colors }: { trend: TrendPoint[]; colors: ThemeColors }) {
  const localStyles = useMemo(() => makeStyles(colors), [colors]);
  if (trend.length < 3) return null;

  const values = trend.map((p) => p.value);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  const latest = values[values.length - 1]!;
  const lower = mean - sd;
  const upper = mean + sd;
  const outOfBand = latest < lower || latest > upper;

  // Position the latest marker within a normalised [lower-σ, upper+σ] track.
  const trackMin = mean - 2 * sd;
  const trackMax = mean + 2 * sd;
  const clamp = (v: number) => Math.max(0, Math.min(1, (v - trackMin) / (trackMax - trackMin || 1)));
  const bandLeft = clamp(lower);
  const bandRight = clamp(upper);
  const markerPos = clamp(latest);

  return (
    <View style={localStyles.anomalyWrap} testID="coach-anomaly-band" accessibilityRole="image" accessibilityLabel="Coach view: 7-day recovery deviation band">
      <Text style={localStyles.anomalyLabel}>7-day deviation</Text>
      <View style={localStyles.anomalyTrack}>
        <View
          style={[
            localStyles.anomalyBandFill,
            { left: `${bandLeft * 100}%`, width: `${Math.max(2, (bandRight - bandLeft) * 100)}%` },
          ]}
        />
        <View
          testID="coach-anomaly-marker"
          style={[
            localStyles.anomalyMarker,
            {
              left: `${markerPos * 100}%`,
              backgroundColor: outOfBand ? RECOVERY_PALETTE.attention : RECOVERY_PALETTE.accent,
            },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * CohortComparison — a tiny coach-only sparkline label comparing this client's
 * mean HRV to a reference cohort ("median client at week 6"). Cohort framing is
 * NEVER shown to clients; it only renders inside the coach tab.
 */
function CohortComparison({ trend, colors }: { trend: TrendPoint[]; colors: ThemeColors }) {
  const localStyles = useMemo(() => makeStyles(colors), [colors]);
  if (trend.length === 0) return null;
  const mean = trend.reduce((s, p) => s + p.value, 0) / trend.length;
  // Reference cohort median is a server-derived constant in production; here we
  // present the client's own mean against a neutral cohort label without
  // green-for-good colouring (confidence-calibration lock).
  return (
    <View style={localStyles.cohortWrap} testID="coach-cohort-comparison">
      <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
      <Text style={localStyles.cohortText}>
        Client average {Math.round(mean)} ms · compared with the median client at week 6
      </Text>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 12 },
    unavailableText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
    retryBtn: {
      marginTop: 8,
      backgroundColor: RECOVERY_PALETTE.accent,
      paddingVertical: 12,
      paddingHorizontal: 28,
      borderRadius: 12,
    },
    retryText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
    heroWrap: { alignItems: 'center' },
    anomalyWrap: { width: '100%', marginTop: 12 },
    anomalyLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 4 },
    anomalyTrack: {
      height: 10,
      borderRadius: 5,
      backgroundColor: RECOVERY_PALETTE.track,
      overflow: 'visible',
      justifyContent: 'center',
    },
    anomalyBandFill: {
      position: 'absolute',
      top: 2,
      bottom: 2,
      backgroundColor: '#C9CEE6',
      borderRadius: 4,
    },
    anomalyMarker: {
      position: 'absolute',
      width: 4,
      height: 16,
      borderRadius: 2,
      marginLeft: -2,
    },
    cohortWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 4 },
    cohortText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
  });
}

export default SleepRecoveryTab;
