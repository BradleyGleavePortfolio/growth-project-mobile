/**
 * ConnectionsScreen — the Connections Hub (Agent 1 §3.1 / §3.6).
 *
 * "Where users see and manage every health data source." One identical row
 * pattern for all 20+ providers (Agent 1 §3.6 provider-parity rule; the
 * webhook-vs-poll mechanics are absorbed server-side per Tesler's Law and never
 * surfaced here). Per the locked build decisions the bucket-segmented switcher
 * lives ONLY on the Health destination tabs (PR-HK-3a/3b); the Connections Hub
 * is a FLAT list showing ALL providers (both buckets together).
 *
 * Each provider row shows:
 *   • brand icon (placeholder glyph until an asset lands) + provider name,
 *   • a status badge — connected (green) / expired (amber) / error (red) /
 *     disconnected (grey),
 *   • last-synced relative time ("12m ago"),
 *   • a primary action — Connect / Reconnect / Disconnect.
 *
 * Data comes from `useWearableConnections` (cache key ['wearable-connections']).
 * The list is the join of the user's existing connections with the full
 * provider catalog so providers the user has not connected yet still appear
 * with a Connect button. Tapping Connect / Reconnect opens
 * `ConnectProviderSheet`; Disconnect calls the soft-disconnect mutation.
 *
 * States: loading skeleton, error-with-retry, and a per-row pending state on
 * disconnect. Every interactive element carries an accessibilityLabel + role.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  configFor,
  WEARABLE_PROVIDERS,
  type WearableConnection,
  type WearableProvider,
} from '../../../api/wearablesConnectionsApi';
import {
  useDisconnectProvider,
  useWearableConnections,
} from '../../../hooks/useWearableConnections';
import { colors, radius, spacing, typography } from '../../../theme/tokens';
import ConnectProviderSheet from './ConnectProviderSheet';

// ─── Status presentation ──────────────────────────────────────────────────────

type BadgeTone = 'connected' | 'expired' | 'error' | 'disconnected';

/** Map a (possibly unknown) backend status string to a UI badge tone. */
function badgeTone(status: string): BadgeTone {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'expired':
      return 'expired';
    case 'error':
      return 'error';
    default:
      // disconnected + any unknown/forward-compat value → neutral grey.
      return 'disconnected';
  }
}

const BADGE_COLORS: Record<BadgeTone, { bg: string; fg: string; label: string }> = {
  connected: { bg: '#E4EBE6', fg: colors.forest, label: 'Connected' },
  expired: { bg: colors.warningBg, fg: colors.warningInk, label: 'Expired' },
  error: { bg: '#F7E4E4', fg: colors.error, label: 'Error' },
  disconnected: { bg: colors.cream, fg: colors.charcoal, label: 'Not connected' },
};

/** The primary action a row offers, derived from its status. */
type RowAction = 'connect' | 'reconnect' | 'disconnect';

function rowAction(status: BadgeTone): RowAction {
  if (status === 'connected') return 'disconnect';
  if (status === 'expired' || status === 'error') return 'reconnect';
  return 'connect';
}

const ACTION_LABEL: Record<RowAction, string> = {
  connect: 'Connect',
  reconnect: 'Reconnect',
  disconnect: 'Disconnect',
};

// ─── Relative time ─────────────────────────────────────────────────────────────

/**
 * Humanize an ISO timestamp into a short relative string ("12m ago", "3h ago",
 * "2d ago"). No date-fns dependency (CFG owns package.json), so this is a tiny
 * self-contained formatter. Returns null for nullish/invalid inputs so the row
 * can omit the chip rather than render "Invalid Date".
 */
export function relativeTime(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = now - t;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

// ─── Row view-model ────────────────────────────────────────────────────────────

interface ProviderRow {
  provider: WearableProvider;
  status: BadgeTone;
  lastSyncedAt: string | null;
}

/**
 * Build the flat row list: every provider in the catalog, enriched with the
 * user's connection status when one exists. Connected/expired/error rows sort
 * first (they need attention or are active); not-connected rows follow. Within
 * a tier, alphabetical by display name for stable ordering.
 */
export function buildRows(connections: WearableConnection[]): ProviderRow[] {
  const byProvider = new Map<WearableProvider, WearableConnection>();
  for (const c of connections) {
    // If multiple rows exist for a provider (re-links), keep the most recent.
    const existing = byProvider.get(c.provider);
    if (!existing || Date.parse(c.updated_at) > Date.parse(existing.updated_at)) {
      byProvider.set(c.provider, c);
    }
  }

  const rows: ProviderRow[] = WEARABLE_PROVIDERS.map((provider) => {
    const conn = byProvider.get(provider);
    return {
      provider,
      status: conn ? badgeTone(conn.status) : 'disconnected',
      lastSyncedAt: conn?.last_synced_at ?? null,
    };
  });

  const tier = (s: BadgeTone): number =>
    s === 'connected' ? 0 : s === 'error' || s === 'expired' ? 1 : 2;

  return rows.sort((a, b) => {
    const ta = tier(a.status);
    const tb = tier(b.status);
    if (ta !== tb) return ta - tb;
    return configFor(a.provider).displayName.localeCompare(
      configFor(b.provider).displayName,
    );
  });
}

// ─── Row component ─────────────────────────────────────────────────────────────

interface ConnectionRowProps {
  row: ProviderRow;
  disconnecting: boolean;
  onConnect: (provider: WearableProvider) => void;
  onDisconnect: (provider: WearableProvider) => void;
}

function ConnectionRow({
  row,
  disconnecting,
  onConnect,
  onDisconnect,
}: ConnectionRowProps) {
  const config = configFor(row.provider);
  const badge = BADGE_COLORS[row.status];
  const action = rowAction(row.status);
  const synced = relativeTime(row.lastSyncedAt);

  const handlePress = useCallback(() => {
    if (action === 'disconnect') onDisconnect(row.provider);
    else onConnect(row.provider);
  }, [action, row.provider, onConnect, onDisconnect]);

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${config.displayName}, ${badge.label}${
        synced ? `, last synced ${synced}` : ''
      }`}
    >
      {/* Decorative brand glyph — conveyed to AT via the row label. */}
      <Text style={styles.rowIcon} importantForAccessibility="no">
        {config.icon}
      </Text>

      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{config.displayName}</Text>
        <View style={styles.rowMeta}>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.fg }]}>
              {badge.label}
            </Text>
          </View>
          {synced != null && <Text style={styles.synced}>{synced}</Text>}
        </View>
      </View>

      <Pressable
        style={[
          styles.action,
          action === 'disconnect' && styles.actionSecondary,
          disconnecting && styles.actionDisabled,
        ]}
        onPress={handlePress}
        disabled={disconnecting}
        accessibilityRole="button"
        accessibilityState={{ disabled: disconnecting }}
        accessibilityLabel={`${ACTION_LABEL[action]} ${config.displayName}`}
      >
        {disconnecting ? (
          <ActivityIndicator
            size="small"
            color={action === 'disconnect' ? colors.charcoal : colors.bone}
          />
        ) : (
          <Text
            style={[
              styles.actionText,
              action === 'disconnect' && styles.actionTextSecondary,
            ]}
          >
            {ACTION_LABEL[action]}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function ConnectionsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } =
    useWearableConnections();
  const disconnect = useDisconnectProvider();

  const [sheetProvider, setSheetProvider] = useState<WearableProvider | null>(
    null,
  );
  const [sheetVisible, setSheetVisible] = useState(false);

  const rows = useMemo(() => buildRows(data ?? []), [data]);

  const openConnect = useCallback((provider: WearableProvider) => {
    setSheetProvider(provider);
    setSheetVisible(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetVisible(false);
    setSheetProvider(null);
  }, []);

  const handleDisconnect = useCallback(
    (provider: WearableProvider) => {
      disconnect.mutate(provider);
    },
    [disconnect],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header />
        <View
          style={styles.center}
          accessibilityLabel="Loading your connections"
          accessibilityRole="progressbar"
        >
          <ActivityIndicator color={colors.forest} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header />
        <View style={styles.center}>
          <Text style={styles.errorTitle} accessibilityRole="alert">
            We couldn&apos;t load your connections
          </Text>
          <Pressable
            style={styles.retry}
            onPress={() => refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading connections"
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.provider}
        contentContainerStyle={styles.listContent}
        refreshing={isRefetching}
        onRefresh={refetch}
        ItemSeparatorComponent={Separator}
        // The catalog is a small, fixed set (15 providers); render the whole
        // list up front so there is no virtualization windowing on a short list.
        initialNumToRender={WEARABLE_PROVIDERS.length}
        windowSize={WEARABLE_PROVIDERS.length}
        removeClippedSubviews={false}
        renderItem={({ item }) => (
          <ConnectionRow
            row={item}
            disconnecting={
              disconnect.isPending && disconnect.variables === item.provider
            }
            onConnect={openConnect}
            onDisconnect={handleDisconnect}
          />
        )}
      />
      <ConnectProviderSheet
        provider={sheetProvider}
        visible={sheetVisible}
        onClose={closeSheet}
        onConnected={closeSheet}
      />
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle} accessibilityRole="header">
        Connections
      </Text>
      <Text style={styles.headerSubtitle}>
        Manage the apps and devices that feed your health data.
      </Text>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.ink,
  },
  headerSubtitle: {
    ...typography.bodySmall,
    color: colors.charcoal,
    marginTop: spacing.xs,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  rowIcon: {
    fontSize: 26,
    marginRight: spacing.md,
    width: 32,
    textAlign: 'center',
  },
  rowMain: {
    flex: 1,
  },
  rowName: {
    ...typography.h4,
    color: colors.ink,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  badgeText: {
    ...typography.micro,
  },
  synced: {
    ...typography.bodySmall,
    color: colors.stone,
    marginLeft: spacing.md,
  },
  action: {
    backgroundColor: colors.forest,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minWidth: 96,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  actionSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.stone,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    ...typography.bodySmall,
    color: colors.bone,
    fontWeight: '500',
  },
  actionTextSecondary: {
    color: colors.charcoal,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.stone,
  },
  errorTitle: {
    ...typography.h3,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retry: {
    backgroundColor: colors.forest,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  retryText: {
    ...typography.bodyMd,
    color: colors.bone,
  },
});
