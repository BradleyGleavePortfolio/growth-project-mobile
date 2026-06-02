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
 * Tiers (brief §4 / _uiux_paper freshness chip + R1 visual P1 #3 stale tier):
 *   - "All sources current"       → current  (cool/forest "success" tone)
 *   - "N sources syncing"         → stale    (soft amber — last sync > 6h, not errored)
 *   - "N sources need attention"  → attention (amber/warning, expired/error)
 *   - "No sources connected"      → empty    (neutral, routes to Connections)
 *
 * The `stale` tier (between `current` and `attention`) gives the user the
 * actionable nuance the binary current/attention signal lacked — a soft amber
 * "syncing" read for a healthy-but-lagging tracker vs. a hard "needs
 * attention" for an expired/errored one (Notion progressive-disclosure /
 * information-density-via-gradient, Mobile Design Intel doc).
 *
 * Callers pass only `{ bucket, tone?, onPress? }` (HK-3b contract); the chip
 * reads connections from the internal hook. An optional `connections` override
 * is accepted so existing call sites + tests can inject a fixture without a
 * QueryClientProvider.
 *
 * Component split (R2 P1 #3): the rendering is a PURE component
 * ({@link FreshnessChipPure}) that takes a resolved `connections` list and
 * calls NO hook. The exported {@link FreshnessChip} is a thin wrapper that
 * SHORT-CIRCUITS the hook entirely when a `connections` prop is supplied —
 * only reaching for `useWearableConnections()` when the caller has none. This
 * removes the hidden state-coupling that forced every render site (and test)
 * of the chip to provide a QueryClientProvider.
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
import { useWearableConnections } from '../../../../hooks/useWearableConnections';
import { toneTokens, type BucketTone } from '../wearablesTheme';

type PlanBucket = 'HEALTH_FITNESS' | 'SLEEP_RECOVERY';

/**
 * Hours since a connected provider last synced before it reads as "stale" (a
 * soft amber "syncing" signal, distinct from an errored "needs attention").
 * 6h is the tightest window that does not false-positive on H&F's
 * minutes-to-hours sync cadence; if the backend later exposes a per-provider
 * freshness tier we consume that instead (brief §4 visual P1 #3).
 */
export const FRESHNESS_STALE_HOURS = 6;
const STALE_MS = FRESHNESS_STALE_HOURS * 60 * 60 * 1000;

/** A connection "needs attention" when it is not actively connected. */
function needsAttention(status: string): boolean {
  return status === 'expired' || status === 'error';
}

/**
 * A connected, non-errored provider is "stale" when its last sync is older
 * than {@link FRESHNESS_STALE_HOURS}. A missing `last_synced_at` is treated as
 * stale (we have a linked source but no confirmed sync yet) rather than
 * defaulting to "current".
 */
function isStale(conn: WearableConnection, now: number): boolean {
  if (conn.status !== 'connected') return false;
  if (!conn.last_synced_at) return true;
  const t = Date.parse(conn.last_synced_at);
  if (Number.isNaN(t)) return true;
  return now - t > STALE_MS;
}

export type FreshnessTier = 'current' | 'stale' | 'attention' | 'empty';

export interface FreshnessSummary {
  readonly tone: FreshnessTier;
  readonly label: string;
  /** Providers (for this bucket) that are connected at all. */
  readonly connectedCount: number;
  /** Connected providers that need attention (expired / error). */
  readonly attentionCount: number;
  /** Connected, non-errored providers whose last sync is stale (> N hours). */
  readonly staleCount: number;
}

/**
 * Pure reducer: given the user's connections and the bucket, compute the chip
 * summary. Exported + unit-tested so the (non-trivial) pluralisation and tier
 * thresholds are verified without rendering. `now` is injectable so the stale
 * threshold is deterministically testable.
 */
export function summariseFreshness(
  connections: readonly WearableConnection[],
  bucket: WearableMetricBucket,
  now: number = Date.now(),
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
      staleCount: 0,
    };
  }

  const attentionCount = relevant.filter((c) => needsAttention(c.status)).length;
  const staleCount = relevant.filter((c) => isStale(c, now)).length;

  // Hard problems (expired/errored) outrank a soft "syncing" lag.
  if (attentionCount > 0) {
    return {
      tone: 'attention',
      label:
        attentionCount === 1
          ? '1 source needs attention'
          : `${attentionCount} sources need attention`,
      connectedCount: relevant.length,
      attentionCount,
      staleCount,
    };
  }

  if (staleCount > 0) {
    return {
      tone: 'stale',
      label:
        staleCount === 1 ? '1 source syncing' : `${staleCount} sources syncing`,
      connectedCount: relevant.length,
      attentionCount: 0,
      staleCount,
    };
  }

  return {
    tone: 'current',
    label: 'All sources current',
    connectedCount: relevant.length,
    attentionCount: 0,
    staleCount: 0,
  };
}

/**
 * Backwards-compatible alias requested by the builder brief: a pure tier
 * reducer that returns just the tier. Kept thin (delegates to
 * {@link summariseFreshness}) so there is a single source of truth for the
 * threshold logic.
 */
export function computeFreshnessTier(args: {
  connections: readonly WearableConnection[];
  bucket: WearableMetricBucket;
  now?: number;
}): FreshnessTier {
  return summariseFreshness(args.connections, args.bucket, args.now).tone;
}

interface Props {
  readonly bucket: WearableMetricBucket;
  /**
   * Palette tone. `cool` → Sleep & Recovery (forest), `warm` → Health &
   * Fitness (clay/amber). Only used for the chevron/text accent in the
   * neutral `empty` tier; the `current`/`stale`/`attention` tiers use their
   * own semantic palette so the meaning (good / syncing / problem) never
   * depends on the bucket. Defaults from the bucket when omitted.
   */
  readonly tone?: BucketTone;
  readonly onPress?: () => void;
  /**
   * Optional connections override. When provided, the chip uses it directly
   * (so a test/fixture can render without a QueryClientProvider and existing
   * call sites that already hold the list can pass it). When omitted, the chip
   * reads `useWearableConnections()` itself (HK-3b contract: callers pass only
   * `{ bucket, tone?, onPress? }`).
   */
  readonly connections?: readonly WearableConnection[];
}

const TIER_STYLE: Record<
  FreshnessTier,
  {
    bg: string;
    fg: string;
    icon: 'checkmark-circle' | 'sync-circle' | 'alert-circle' | 'add-circle-outline';
  }
> = {
  current: { bg: semantic.success.bg, fg: semantic.success.fg, icon: 'checkmark-circle' },
  // Soft amber "syncing" — the existing warning triad (never a new hex).
  stale: { bg: semantic.warning.bg, fg: semantic.warning.fg, icon: 'sync-circle' },
  attention: { bg: semantic.warning.bg, fg: semantic.warning.fg, icon: 'alert-circle' },
  empty: { bg: colors.cream, fg: colors.charcoal, icon: 'add-circle-outline' },
};

/** Props for the pure chip — `connections` is always resolved by the caller. */
interface PureProps {
  readonly bucket: WearableMetricBucket;
  readonly tone?: BucketTone;
  readonly onPress?: () => void;
  readonly connections: readonly WearableConnection[];
}

/**
 * Pure presentational chip. Takes a resolved connections list and calls NO
 * hook, so it renders in any tree (no QueryClientProvider required). Exported
 * for the wrapper, render tests, and any call site that already holds the list.
 */
export function FreshnessChipPure({ bucket, tone, onPress, connections }: PureProps) {
  const summary = useMemo(
    () => summariseFreshness(connections, bucket),
    [connections, bucket],
  );
  const tier = TIER_STYLE[summary.tone];

  // The palette tone only colours the neutral `empty` tier's chevron so the
  // chip reads as part of its bucket; semantic tiers keep their own fg.
  const accentFg =
    summary.tone === 'empty'
      ? toneTokens(tone ?? (bucket === 'HEALTH_FITNESS' ? 'warm' : 'cool')).accent
      : tier.fg;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${summary.label}. Tap to manage your connected sources.`}
      // P0: the chip is ~26pt visual; an 8pt hitSlop left the total tap
      // surface (~42pt) under the HIG 44pt floor. Raise to 12pt each side
      // (≈ 50pt total) — no layout change, the chip stays compact in the
      // hero corner while edge taps register reliably.
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={[styles.chip, { backgroundColor: tier.bg }]}
    >
      <Ionicons name={tier.icon} size={16} color={tier.fg} />
      <Text style={[styles.label, { color: tier.fg }]} numberOfLines={1}>
        {summary.label}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={accentFg} />
    </Pressable>
  );
}

/**
 * Hook-backed variant: reads the user's connections from
 * `useWearableConnections()` then delegates to the pure chip. Rendered ONLY by
 * the {@link FreshnessChip} wrapper when the caller supplied no `connections`
 * prop, so the hook (and its QueryClient requirement) never runs for call
 * sites that already hold the list.
 */
function FreshnessChipConnected({
  bucket,
  tone,
  onPress,
}: Omit<Props, 'connections'>) {
  const hookQuery = useWearableConnections();
  const resolved = useMemo(() => hookQuery.data ?? [], [hookQuery.data]);
  return (
    <FreshnessChipPure
      bucket={bucket}
      tone={tone}
      onPress={onPress}
      connections={resolved}
    />
  );
}

/**
 * The exported chip. When a `connections` prop is provided the hook is skipped
 * entirely (pure path); otherwise the hook-backed variant resolves the list.
 */
export function FreshnessChip({ connections, ...rest }: Props) {
  if (connections !== undefined) {
    return <FreshnessChipPure {...rest} connections={connections} />;
  }
  return <FreshnessChipConnected {...rest} />;
}

export default FreshnessChip;

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
