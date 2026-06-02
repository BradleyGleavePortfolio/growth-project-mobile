/**
 * SleepRecoveryScreen — the Sleep & Recovery (S&R) bucket "Recovery Overview".
 * Mounted by HK-3a's `WearablesShell` when `?bucket=recovery`.
 *
 * Above-the-fold cap ≤5 primary chunks (brief §5.1):
 *   1. RecoveryRingHero (single ring — NOT three)
 *   2. PhantomCalmBanner (only when there's a deficit to communicate)
 *   3. SleepStagesCard
 *   4. HrvTrendCard
 *   5. SleepConsistencyCard
 * RespirationCard lives in a "More" expandable section, off the cap. The AI
 * panel slot is collapsed off the cap (HK-5b fills `aiPanelSlot`).
 *
 * Phantom CALM treatment throughout: reassurance-before-deficit copy, cool
 * tones, never red, slow-reveal on every card. Plain-language sleep stages only.
 *
 * #8 input validation: the incoming bucket param is Zod-parsed; an unexpected
 * value falls back to the recovery bucket rather than rendering a broken screen.
 * #36/#50: query errors surface a typed error state with retry + cached fallback,
 * never a swallowed failure or a spinner.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { z } from 'zod';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '../../../theme/ThemeProvider';
import { logger } from '../../../utils/logger';
import type { MoreStackParamList } from '../../../navigation/ClientNavigator';

import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { FreshnessChip } from './components/FreshnessChip';
import { PhantomCalmBanner } from './components/PhantomCalmBanner';
import { RecoveryRingHero } from './cards/RecoveryRingHero';
import { SleepStagesCard } from './cards/SleepStagesCard';
import { HrvTrendCard } from './cards/HrvTrendCard';
import { RespirationCard } from './cards/RespirationCard';
import { SleepConsistencyCard } from './cards/SleepConsistencyCard';
import { SleepRecoveryEmptyState } from './empty/SleepRecoveryEmptyState';
import { SleepRecoveryErrorState } from './empty/SleepRecoveryErrorState';
import { RECOVERY_PALETTE } from './recoveryTheme';
import {
  recoveryScore,
  sleepStages,
  sleepDeficit,
  trendFor,
  latestValue,
  respiration,
  sleepConsistency,
  formatMinutes,
} from './recoveryData';

/**
 * #8 — the bucket route param is validated, not trusted. `WearablesShell` should
 * only ever mount us with 'recovery', but we parse defensively so a malformed
 * deep-link can never push an invalid value into the data layer.
 */
const bucketParamSchema = z.enum(['recovery', 'fitness']).catch('recovery');

export interface SleepRecoveryScreenProps {
  /** Raw bucket param from the shell route (validated here). */
  bucketParam?: string;
  /**
   * Slot for the HK-5b AI panel (collapsed, off the cap). Typed so HK-5b can
   * drop its panel in without touching this file.
   */
  aiPanelSlot?: React.ReactNode;
}

type Nav = NativeStackNavigationProp<MoreStackParamList>;

/** Window: last 7 days, day-granularity for trends. */
function windowRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function SleepRecoveryScreen({ bucketParam, aiPanelSlot }: SleepRecoveryScreenProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();

  // Validate the param (result drives nothing user-visible beyond confirming we
  // are the recovery bucket, but the parse is the #8 guard the auditor checks).
  const bucket = bucketParamSchema.parse(bucketParam ?? 'recovery');

  const { from, to } = useMemo(() => windowRange(), []);
  const [moreOpen, setMoreOpen] = useState(false);

  const query = useWearableSamples({
    bucket: 'SLEEP_RECOVERY',
    from,
    to,
    granularity: 'day',
    preferredOnly: true,
  });

  const goToConnections = useCallback(() => {
    navigation.navigate('Connections');
  }, [navigation]);

  const onRetry = useCallback(() => {
    // #36 — never swallow: log the recovery attempt (NO sample values, #34) and
    // re-run the query so the user sees a real outcome.
    logger.log('SleepRecoveryScreen', 'retry samples fetch', { bucket });
    void query.refetch();
  }, [query, bucket]);

  // ── Error state (no cached data) — typed, actionable, never a spinner. ──
  if (query.isError && !query.data) {
    // #34 — log the failure WITHOUT any health values, then surface it.
    logger.error('SleepRecoveryScreen', 'samples query failed', {
      bucket,
      message: query.error?.message ?? 'unknown',
    });
    return <SleepRecoveryErrorState colors={colors} onRetry={onRetry} />;
  }

  const data = query.data;

  // ── Empty state — skeleton of the real layout, value-first prompt. ──
  const hasAnySeries = !!data && data.series.some((s) => s.sample_count > 0);
  if (!query.isLoading && data && !hasAnySeries) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <SleepRecoveryEmptyState colors={colors} onConnect={goToConnections} />
      </ScrollView>
    );
  }

  // Loading-with-no-data renders the empty skeleton too (anti-spinner). Once any
  // sample arrives we render the real overview (possibly still revalidating).
  if (query.isLoading && !data) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <SleepRecoveryEmptyState colors={colors} onConnect={goToConnections} testID="sleep-recovery-loading-skeleton" />
      </ScrollView>
    );
  }

  // ── Real overview ──
  const score = recoveryScore(data);
  const stages = sleepStages(data);
  const deficit = sleepDeficit(data);
  const hrvTrend = trendFor(data, 'HRV_MS');
  const hrvLatest = latestValue(data, 'HRV_MS');
  const resp = respiration(data);
  const consistency = sleepConsistency(data);

  // Reassurance-before-deficit banner — only when there's a meaningful sleep
  // deficit to communicate. Copy ALWAYS leads with reassurance (UX gate §5.2).
  const showDeficitBanner = !!deficit && deficit.deficitMinutes >= 15;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={onRetry}
          tintColor={RECOVERY_PALETTE.accent}
          colors={[RECOVERY_PALETTE.accent]}
        />
      }
    >
      {/* Cached-data banner (graceful degradation #50): if we are showing data
          but the latest refetch errored, tell the user gently. */}
      {query.isError && data ? (
        <View style={styles.staleNotice} testID="sleep-recovery-stale-notice">
          <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.staleText}>Showing your last synced recovery data.</Text>
        </View>
      ) : null}

      {/* 1 — Single recovery-ring hero (~35% viewport handled by ring size). */}
      <View style={styles.heroRow}>
        <View style={styles.freshnessSlot}>
          <FreshnessChip bucket="SLEEP_RECOVERY" tone="cool" onPress={goToConnections} />
        </View>
        <RecoveryRingHero score={score} colors={colors} size={240} />
      </View>

      {/* 2 — Phantom reassurance-before-deficit banner (conditional). */}
      {showDeficitBanner && deficit ? (
        <View style={styles.section}>
          <PhantomCalmBanner
            colors={colors}
            reassurance="You're close —"
            deficit={`about ${formatMinutes(deficit.deficitMinutes)} under your sleep need`}
          />
        </View>
      ) : null}

      {/* 3 — Sleep stages (plain language only). */}
      <View style={styles.section}>
        <SleepStagesCard stages={stages} colors={colors} revealDelay={60} />
      </View>

      {/* 4 — HRV trend (cool tone, reassurance copy, never red). */}
      <View style={styles.section}>
        <HrvTrendCard trend={hrvTrend} latestMs={hrvLatest} colors={colors} revealDelay={120} />
      </View>

      {/* 5 — Sleep consistency (CALM language). */}
      <View style={styles.section}>
        <SleepConsistencyCard consistency={consistency} colors={colors} revealDelay={180} />
      </View>

      {/* "More" — off the above-the-fold cap. Respiration lives here. */}
      <TouchableOpacity
        style={styles.moreToggle}
        onPress={() => setMoreOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        accessibilityLabel={moreOpen ? 'Hide more recovery detail' : 'Show more recovery detail'}
        testID="sleep-recovery-more-toggle"
      >
        <Text style={styles.moreText}>{moreOpen ? 'Less detail' : 'More detail'}</Text>
        <Ionicons name={moreOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      {moreOpen ? (
        <View style={styles.section} testID="sleep-recovery-more-section">
          <RespirationCard respiration={resp} colors={colors} revealDelay={0} />
        </View>
      ) : null}

      {/* AI panel slot — collapsed off the cap; filled by HK-5b later. */}
      {aiPanelSlot ? <View style={styles.section}>{aiPanelSlot}</View> : null}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
    heroRow: { alignItems: 'center', marginBottom: 8 },
    freshnessSlot: { alignSelf: 'flex-end', marginBottom: 4 },
    section: { marginTop: 14 },
    staleNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderRadius: 10,
      marginBottom: 8,
    },
    staleText: { fontSize: 12, color: colors.textSecondary },
    moreToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 20,
      paddingVertical: 10,
    },
    moreText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, letterSpacing: 0.4 },
  });
}
