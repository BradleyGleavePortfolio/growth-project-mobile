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
 * REDO-DEVICES-133 (DES-AZ-127): an editorial page, not a grid of chips. A
 * serif title stack, then two hairline sections, "In use" (connected and
 * needs-attention sources) and "Available to connect". Each row shows:
 *   • the provider name and, for cloud trackers, what it brings in,
 *   • its status as a word with a small mark (forest = connected, warm =
 *     sync stopped), and the real last sync ("Last synced 12m ago"; a
 *     connected source with no sync yet says "No sync yet"),
 *   • one text action on the right — Connect / Reconnect / Disconnect.
 *
 * Data comes from `useWearableConnections` (cache key ['wearable-connections']).
 * The list is the join of the user's existing connections with the sources
 * this phone can connect (AUDIT-11-125: Apple Health on iPhone, Health Connect
 * and Samsung Health on Android) plus the cloud trackers the server lists as
 * connectable (B-WEARLIST-125, `useConnectableCloudProviders`), so those
 * appear with a Connect button even before a first connect. Tapping Connect / Reconnect opens
 * `ConnectProviderSheet`; Disconnect asks first (DisconnectConfirmDialog, S14 round 4b) and then calls the soft-disconnect mutation.
 *
 * States: loading skeleton, error-with-retry, and a per-row pending state on
 * disconnect. Every interactive element carries an accessibilityLabel + role.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
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
import { layout, radius, semantic, typography } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import HapticPressable from '../../../components/HapticPressable';
import { Headline, Lede, Overline, QuietSection, Screen, ScreenTopBar } from '../../../ui';
import { QuietError, QuietLoading, loadFailureMessage } from '../../../ui/states/QuietStates';
import ConnectProviderSheet from './ConnectProviderSheet';
import {
  deviceSourceForPlatform,
  isConnectedButNotSyncingHere,
} from '../../../services/health/onDeviceSync';
import { notSyncingHereCopy } from './onDeviceCopy';
import DisconnectConfirmDialog from './DisconnectConfirmDialog';
import { disconnectFailureMessage } from './disconnectCopy';
import { isOnDeviceStop } from '../../../services/health/sessionFence';
import { useConnectableCloudProviders } from '../../../hooks/useConnectableCloudProviders';
import { useCoachlessClient } from '../../../hooks/useCoachlessClient';
import { cloudBenefit } from './cloudCopy';

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

/**
 * REDO-DEVICES-133: status is a word with a small mark, not a tinted chip
 * (CATALOG: no status hue swaps). The labels are the same words as before.
 * `attention` rows (sync stopped) get the warm mark and ink label.
 */
const STATUS_TEXT: Record<BadgeTone, { label: string; attention: boolean }> = {
  connected: { label: 'Connected', attention: false },
  notSyncing: { label: 'Not syncing here', attention: true },
  expired: { label: 'Expired', attention: true },
  error: { label: 'Error', attention: true },
  disconnected: { label: 'Not connected', attention: false },
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
 * AUDIT-11-125: true when this phone can connect the provider itself: Apple
 * Health on an iPhone, Health Connect (and Samsung Health, which shares
 * through it) on Android. The cloud services in the catalog (Garmin, Oura,
 * WHOOP, ...) are not switched on for launch, so offering Connect for them, or
 * for the other platform's store, only ever ended in "isn't switched on yet".
 */
function connectableHere(
  provider: WearableProvider,
  here: WearableProvider | null,
  cloud: ReadonlySet<WearableProvider>,
): boolean {
  // B-WEARLIST-125: a cloud tracker is offered once the server lists it as
  // connectable (switch on, keys set); an older server lists none.
  if (cloud.has(provider)) return true;
  if (here == null) return false;
  if (provider === here) return true;
  return here === 'HEALTH_CONNECT' && provider === 'SAMSUNG_HEALTH';
}

const NO_CLOUD: ReadonlySet<WearableProvider> = new Set<WearableProvider>();

/**
 * Build the flat row list: the sources this phone can connect, plus any other
 * provider the person already has a connection for (so it can still be
 * reconnected or disconnected), enriched with the connection status.
 * Connected/expired/error rows sort first (they need attention or are
 * active); not-connected rows follow. Within a tier, alphabetical by display
 * name for stable ordering.
 */
export function buildRows(
  connections: WearableConnection[],
  local?: { provider: WearableProvider; connectionId: string | null } | null,
  here: WearableProvider | null = deviceSourceForPlatform(),
  cloud: ReadonlySet<WearableProvider> = NO_CLOUD,
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
  ).filter((row) => row.status !== 'disconnected' || connectableHere(row.provider, here, cloud));

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
  first: boolean;
  disconnecting: boolean;
  onConnect: (provider: WearableProvider) => void;
  onDisconnect: (provider: WearableProvider) => void;
}

/**
 * One hairline row: the source name, what it brings in, its status as a word
 * and when it last synced; the one action sits on the right as forest text
 * (Connect / Reconnect) or muted text (Disconnect), never a filled box.
 */
function ConnectionRow({
  row,
  first,
  disconnecting,
  onConnect,
  onDisconnect,
}: ConnectionRowProps) {
  const { semanticColors: sc } = useTheme();
  const config = configFor(row.provider);
  const status = STATUS_TEXT[row.status];
  const action = rowAction(row.status);
  const synced = relativeTime(row.lastSyncedAt);
  const benefit = cloudBenefit(row.provider);
  // A connected source that has not synced yet says so (it has no time to show).
  const syncLine =
    synced != null ? `Last synced ${synced}` : row.status === 'connected' ? 'No sync yet' : null;
  const statusColor = status.attention
    ? semantic.warning.fg
    : row.status === 'connected'
      ? sc.textPrimary
      : sc.textMuted;

  const handlePress = useCallback(() => {
    if (action === 'disconnect') onDisconnect(row.provider);
    else onConnect(row.provider);
  }, [action, row.provider, onConnect, onDisconnect]);

  return (
    <View
      style={[styles.row, !first && { borderTopColor: sc.border, borderTopWidth: StyleSheet.hairlineWidth }]}
      accessibilityLabel={`${config.displayName}, ${status.label}${
        synced ? `, last synced ${synced}` : ''
      }${benefit ? `. ${benefit}` : ''}`}
      testID={`connection-row-${row.provider}`}
    >
      <View style={styles.rowMain}>
        <Text style={[styles.rowName, { color: sc.textPrimary }]}>{config.displayName}</Text>
        {benefit != null && <Text style={[styles.detail, { color: sc.textMuted }]}>{benefit}</Text>}
        <View style={styles.rowMeta}>
          {row.status !== 'disconnected' && (
            <View
              importantForAccessibility="no"
              style={[
                styles.mark,
                { backgroundColor: status.attention ? semantic.warning.fg : sc.accent },
              ]}
            />
          )}
          <Text style={[styles.status, { color: statusColor }]}>{status.label}</Text>
          {syncLine != null && (
            <Text style={[styles.synced, { color: sc.textMuted }]}>{syncLine}</Text>
          )}
        </View>
        {row.status === 'notSyncing' && (
          <Text style={[styles.detail, { color: sc.textMuted }]}>
            {notSyncingHereCopy(config.displayName)}
          </Text>
        )}
        {row.provider === 'SAMSUNG_HEALTH' && (
          <Text style={[styles.detail, { color: sc.textMuted }]}>
            Samsung Health shares its data through Health Connect, so this row shows the Health
            Connect connection.
          </Text>
        )}
      </View>

      <HapticPressable
        intent="light"
        onPress={handlePress}
        disabled={disconnecting}
        accessibilityRole="button"
        accessibilityState={{ disabled: disconnecting, busy: disconnecting }}
        accessibilityLabel={`${ACTION_LABEL[action]} ${config.displayName}`}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      >
        {disconnecting ? (
          <ActivityIndicator size="small" color={sc.textMuted} />
        ) : (
          <Text
            style={[
              styles.actionText,
              { color: action === 'disconnect' ? sc.textMuted : sc.accentText },
            ]}
          >
            {ACTION_LABEL[action]}
          </Text>
        )}
      </HapticPressable>
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function ConnectionsScreen() {
  const { data, isLoading, isError, error, refetch, isRefetching } =
    useWearableConnections();
  const disconnect = useDisconnectProvider();
  const { semanticColors: sc } = useTheme();
  // The More stack hides the native header: a back chevron like the references
  // (operator 18:33). Context, not useNavigation, so it renders outside a navigator.
  const navigation = React.useContext(NavigationContext);
  const topBar = navigation?.canGoBack() ? (
    <ScreenTopBar onBack={() => navigation.goBack()} testID="connections-top" />
  ) : undefined;

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
  const cloud = useConnectableCloudProviders();
  // FW-BODY U10: the Connect and Disconnect lines name a coach only when there is one.
  const coachless = useCoachlessClient();
  const rows = useMemo(
    () => buildRows(data ?? [], local, deviceSource, cloud),
    [data, local, deviceSource, cloud],
  );
  // REDO-DEVICES-133: sources in use first, then the ones this phone can add.
  const inUse = useMemo(() => rows.filter((r) => r.status !== 'disconnected'), [rows]);
  const available = useMemo(() => rows.filter((r) => r.status === 'disconnected'), [rows]);

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
      <Screen edges={['top']} testID="connections-loading" header={topBar}>
        <Header />
        <QuietLoading label="Loading your connections" rows={3} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen edges={['top']} testID="connections-error" header={topBar}>
        <Header />
        <QuietError
          layout="inline"
          message={loadFailureLine(error)}
          onRetry={() => void refetch()}
          retryHint="Loads your connections again"
          testID="connections-error-state"
        />
      </Screen>
    );
  }

  const renderRows = (list: ProviderRow[]) =>
    list.map((item, index) => (
      <ConnectionRow
        key={item.provider}
        row={item}
        first={index === 0}
        disconnecting={disconnect.isPending && disconnect.variables === item.provider}
        onConnect={openConnect}
        onDisconnect={handleDisconnect}
      />
    ));

  return (
    <Screen
      edges={['top']}
      testID="connections"
      header={topBar}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={sc.accent}
        />
      }
    >
      <Header />
      {inUse.length > 0 && (
        <QuietSection testID="connections-in-use">
          <Overline accessibilityRole="header">In use</Overline>
          {renderRows(inUse)}
        </QuietSection>
      )}
      {available.length > 0 && (
        <QuietSection testID="connections-available">
          <Overline accessibilityRole="header">Available to connect</Overline>
          {renderRows(available)}
        </QuietSection>
      )}
      {rows.length === 0 && (
        <QuietSection>
          <Text style={[styles.detail, { color: sc.textMuted }]}>
            No health source can connect on this device.
          </Text>
        </QuietSection>
      )}
      <ConnectProviderSheet
        provider={sheetProvider}
        visible={sheetVisible}
        onClose={closeSheet}
        onConnected={closeSheet}
        coachless={coachless}
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
        coachless={coachless}
      />
    </Screen>
  );
}

/** The failed-load line: says what failed; "check your connection" only when nothing answered. */
function loadFailureLine(err: unknown): string {
  return loadFailureMessage(err, 'Your connections');
}

/** Title stack: the same words as the More row that opens this screen. */
function Header() {
  return (
    <View style={styles.header}>
      <Overline>Health data</Overline>
      <Headline level="h1">Connected devices</Headline>
      <Lede>Manage the apps and devices that feed your health data.</Lede>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: layout.sectionGap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.rowMinHeight,
    paddingVertical: 16,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  rowName: {
    ...typography.bodyMd,
  },
  detail: {
    ...typography.bodySmall,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 2,
    marginTop: 2,
  },
  mark: {
    width: 6,
    height: 6,
    borderRadius: radius.chip,
  },
  status: {
    ...typography.bodySmall,
    fontFamily: 'Inter_500Medium',
  },
  synced: {
    ...typography.bodySmall,
    fontVariant: ['tabular-nums'],
  },
  action: {
    minHeight: layout.touchMin,
    minWidth: layout.touchMin,
    paddingLeft: 16,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  actionText: {
    ...typography.bodyMd,
  },
});
