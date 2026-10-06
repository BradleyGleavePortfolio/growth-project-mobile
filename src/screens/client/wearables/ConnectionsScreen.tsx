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
 * `ConnectProviderSheet`; Disconnect asks first (DisconnectConfirmDialog, S14 round 4b) and then calls the soft-disconnect mutation.
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
  useLocalOnDeviceAuthorization,
  useWearableConnections,
} from '../../../hooks/useWearableConnections';
import { colors, radius, semantic, spacing, typography } from '../../../theme/tokens';
import ConnectProviderSheet from './ConnectProviderSheet';
import {
  deviceSourceForPlatform,
  isConnectedButNotSyncingHere,
} from '../../../services/health/onDeviceSync';
import { notSyncingHereCopy } from './onDeviceCopy';
import DisconnectConfirmDialog from './DisconnectConfirmDialog';
import { disconnectFailureMessage } from './disconnectCopy';
import { isOnDeviceStop } from '../../../services/health/sessionFence';

// ─── Status presentation ──────────────────────────────────────────────────────

/**
 * `notSyncing` (S14 B-317-5): the server lists this phone's on-device source
 * as connected, but this phone holds no Connect authorization for the
 * signed-in person and that connection (after a sign-out, on a second phone,
 * after a reinstall), so Health does not read it here until Reconnect.
 */
type BadgeTone = 'connected' | 'notSyncing' | 'expired' | 'error' | 'disconnected';

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
  connected: { bg: semantic.success.bg, fg: semantic.success.fg, label: 'Connected' },
  notSyncing: { bg: semantic.warning.bg, fg: semantic.warning.fg, label: 'Not syncing here' },
  expired: { bg: semantic.warning.bg, fg: semantic.warning.fg, label: 'Expired' },
  error: { bg: semantic.danger.bg, fg: semantic.danger.fg, label: 'Error' },
  disconnected: { bg: colors.cream, fg: colors.charcoal, label: 'Not connected' },
};

/** The primary action a row offers, derived from its status. */
type RowAction = 'connect' | 'reconnect' | 'disconnect';

function rowAction(status: BadgeTone): RowAction {
  if (status === 'connected') return 'disconnect';
  if (status === 'expired' || status === 'error' || status === 'notSyncing') return 'reconnect';
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
export function buildRows(
  connections: WearableConnection[],
  local?: { provider: WearableProvider; connectionId: string | null } | null,
): ProviderRow[] {
  const byProvider = new Map<WearableProvider, WearableConnection>();
  for (const c of connections) {
    // If multiple rows exist for a provider (re-links), keep the most recent.
    const existing = byProvider.get(c.provider);
    if (!existing || Date.parse(c.updated_at) > Date.parse(existing.updated_at)) {
      byProvider.set(c.provider, c);
    }
  }

  const rowFor = (provider: WearableProvider): ProviderRow => {
    const conn = byProvider.get(provider);
    let status: BadgeTone = conn ? badgeTone(conn.status) : 'disconnected';
    if (
      status === 'connected' &&
      local != null &&
      local.provider === provider &&
      (provider === 'APPLE_HEALTHKIT' || provider === 'HEALTH_CONNECT') &&
      isConnectedButNotSyncingHere(provider, connections, local.connectionId)
    ) {
      status = 'notSyncing';
    }
    return {
      provider,
      status,
      lastSyncedAt: conn?.last_synced_at ?? null,
    };
  };
  // B-364-1: Samsung Health has no connection of its own (it shares through
  // Health Connect), so its row mirrors the Health Connect row: the same
  // status, sync time and action. A stored SAMSUNG_HEALTH row is never shown
  // as an active source.
  const rows: ProviderRow[] = WEARABLE_PROVIDERS.map((provider) =>
    provider === 'SAMSUNG_HEALTH' ? { ...rowFor('HEALTH_CONNECT'), provider } : rowFor(provider),
  );

  const tier = (s: BadgeTone): number =>
    s === 'connected' ? 0 : s === 'error' || s === 'expired' || s === 'notSyncing' ? 1 : 2;

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
        {row.status === 'notSyncing' && (
          <Text style={styles.synced}>{notSyncingHereCopy(config.displayName)}</Text>
        )}
        {row.provider === 'SAMSUNG_HEALTH' && (
          <Text style={styles.synced}>
            Samsung Health shares its data through Health Connect, so this row shows the Health
            Connect connection.
          </Text>
        )}
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

  // S14 B-317-5: app storage only (no health store read) — does THIS phone
  // sync the platform source for the signed-in person?
  const deviceSource = deviceSourceForPlatform();
  const localAuth = useLocalOnDeviceAuthorization(deviceSource);
  const local = useMemo(
    () =>
      deviceSource != null && localAuth.data != null
        ? { provider: deviceSource, connectionId: localAuth.data.connectionId }
        : null,
    [deviceSource, localAuth.data],
  );
  const rows = useMemo(() => buildRows(data ?? [], local), [data, local]);

  const openConnect = useCallback((provider: WearableProvider) => {
    setSheetProvider(provider);
    setSheetVisible(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetVisible(false);
    setSheetProvider(null);
  }, []);

  // S14 round 4b (C-317-4): Disconnect asks first. Cancel is the default;
  // a failure keeps the dialog open with coded copy.
  const [confirmProvider, setConfirmProvider] = useState<WearableProvider | null>(null);
  const [disconnectError, setDisconnectError] = useState<{
    text: string;
    canRetry: boolean;
  } | null>(null);

  const handleDisconnect = useCallback((provider: WearableProvider) => {
    setDisconnectError(null);
    setConfirmProvider(provider);
  }, []);

  const cancelDisconnect = useCallback(() => {
    setConfirmProvider(null);
    setDisconnectError(null);
  }, []);

  const confirmDisconnect = useCallback(() => {
    if (confirmProvider == null) return;
    const provider = confirmProvider;
    const name = configFor(provider).displayName;
    setDisconnectError(null);
    // For the Samsung Health row the hook disconnects Health Connect (B-364-1).
    disconnect.mutate(provider, {
      onSuccess: () => {
        setConfirmProvider(null);
      },
      onError: (err: unknown) => {
        // Sol B-362-6: the account changed first and nothing was sent; nothing to report.
        if (isOnDeviceStop(err)) {
          setConfirmProvider(null);
          return;
        }
        const failure = disconnectFailureMessage(err, name);
        if (failure.kind === 'already') {
          setConfirmProvider(null);
          void refetch();
          return;
        }
        setDisconnectError({ text: failure.text, canRetry: failure.kind === 'retry' });
      },
    });
  }, [confirmProvider, disconnect, refetch]);

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
            Your connections did not load
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
      <DisconnectConfirmDialog
        provider={confirmProvider}
        name={confirmProvider != null ? configFor(confirmProvider).displayName : ''}
        visible={confirmProvider != null}
        pending={disconnect.isPending}
        errorText={disconnectError?.text ?? null}
        canRetry={disconnectError?.canRetry ?? true}
        onCancel={cancelDisconnect}
        onConfirm={confirmDisconnect}
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
