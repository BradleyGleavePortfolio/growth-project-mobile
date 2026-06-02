/**
 * FreshnessChip — the floating chip at the top-right of the bucket hero.
 *
 * Per UNIFIED_BUILD_PLAN line 91, freshness is derived CLIENT-SIDE from
 * `useWearableConnections()` over the providers that feed THIS bucket — NOT
 * from a server field. The samples response carries a per-provider
 * `freshness` block too, but the chip's aggregate "needs attention" signal is
 * computed here so it stays correct even when the samples query is loading or
 * errored (the connections list is the user's source-of-truth for which
 * trackers are linked).
 *
 * States (brief §4 / _uiux_paper freshness chip):
 *   - "All sources current"        → cool/forest tone
 *   - "N sources need attention"   → amber/warning tone
 *   - "No sources connected"       → neutral, routes to Connections to add one
 *
 * Tapping the chip routes to the existing ConnectionsScreen so the user can
 * reconnect / add a tracker.
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  radius,
  semantic,
  spacing,
  typography,
} from '../../../../theme/tokens';
import {
  configFor,
  type WearableConnection,
  type WearableProvider,
} from '../../../../api/wearablesConnectionsApi';
import type { WearableMetricBucket } from '../../../../api/wearablesSamplesApi';

type PlanBucket = 'HEALTH_FITNESS' | 'SLEEP_RECOVERY';

/** A connection "needs attention" when it is not actively connected. */
function needsAttention(status: string): boolean {
  return status === 'expired' || status === 'error';
}

export interface FreshnessSummary {
  readonly tone: 'current' | 'attention' | 'empty';
  readonly label: string;
  /** Providers (for this bucket) that are connected at all. */
  readonly connectedCount: number;
  /** Connected providers that need attention (expired / error). */
  readonly attentionCount: number;
}

/**
 * Pure reducer: given the user's connections and the bucket, compute the chip
 * summary. Exported + unit-tested so the (non-trivial) pluralisation and tone
 * thresholds are verified without rendering.
 */
export function summariseFreshness(
  connections: readonly WearableConnection[],
  bucket: WearableMetricBucket,
): FreshnessSummary {
  // Only consider connections whose provider feeds this bucket and that the
  // user has actually linked (status !== 'disconnected').
  const relevant = connections.filter((c) => {
    const cfg = configFor(c.provider as WearableProvider);
    const feedsBucket = (cfg.buckets as readonly PlanBucket[]).includes(
      bucket as PlanBucket,
    );
    return feedsBucket && c.status !== 'disconnected';
  });

  if (relevant.length === 0) {
    return {
      tone: 'empty',
      label: 'No sources connected',
      connectedCount: 0,
      attentionCount: 0,
    };
  }

  const attentionCount = relevant.filter((c) => needsAttention(c.status)).length;
  if (attentionCount === 0) {
    return {
      tone: 'current',
      label: 'All sources current',
      connectedCount: relevant.length,
      attentionCount: 0,
    };
  }

  return {
    tone: 'attention',
    label:
      attentionCount === 1
        ? '1 source needs attention'
        : `${attentionCount} sources need attention`,
    connectedCount: relevant.length,
    attentionCount,
  };
}

interface Props {
  readonly connections: readonly WearableConnection[];
  readonly bucket: WearableMetricBucket;
  readonly onPress: () => void;
}

const TONE_STYLE: Record<
  FreshnessSummary['tone'],
  { bg: string; fg: string; icon: 'checkmark-circle' | 'alert-circle' | 'add-circle-outline' }
> = {
  current: { bg: semantic.success.bg, fg: semantic.success.fg, icon: 'checkmark-circle' },
  attention: { bg: semantic.warning.bg, fg: semantic.warning.fg, icon: 'alert-circle' },
  empty: { bg: colors.cream, fg: colors.charcoal, icon: 'add-circle-outline' },
};

export default function FreshnessChip({ connections, bucket, onPress }: Props) {
  const summary = useMemo(
    () => summariseFreshness(connections, bucket),
    [connections, bucket],
  );
  const tone = TONE_STYLE[summary.tone];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${summary.label}. Tap to manage your connected sources.`}
      style={[styles.chip, { backgroundColor: tone.bg }]}
    >
      <Ionicons name={tone.icon} size={14} color={tone.fg} />
      <Text style={[styles.label, { color: tone.fg }]} numberOfLines={1}>
        {summary.label}
      </Text>
      <Ionicons name="chevron-forward" size={12} color={tone.fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    maxWidth: 220,
  },
  label: {
    ...typography.caption,
    letterSpacing: 0.2,
    textTransform: 'none',
  },
});
