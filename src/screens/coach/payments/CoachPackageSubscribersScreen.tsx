/**
 * CoachPackageSubscribersScreen — list of clients subscribed to a package.
 *
 * Wires GET /v1/coach/packages/:id/subscribers. Renders subscriber state
 * (active / past_due / canceled / trialing) honestly — no fake "all paid"
 * banner if the backend reports a past-due row.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase, RouteProp } from '@react-navigation/native';

import { coachPackagesApi, PackageSubscribersResponse, PackageSubscriber } from '../../../api/packagesApi';
import { errorMessage, errorStatus } from '../../../types/common';
import { useTheme } from '../../../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../../../theme/tokens';
import { formatCurrencyCents } from '../../../utils/currency';
import { Screen } from '../../../ui';
import { layout, radius } from '../../../theme/tokens';

type ParamList = {
  CoachPackageSubscribers: { packageId: string; title: string };
};

interface Props {
  navigation: NavigationProp<ParamListBase>;
  route: RouteProp<ParamList, 'CoachPackageSubscribers'>;
}

const STATUS_COPY: Record<PackageSubscriber['status'], { label: string; tone: 'ok' | 'attention' | 'muted' }> = {
  active: { label: 'Active', tone: 'ok' },
  trialing: { label: 'Trial', tone: 'ok' },
  past_due: { label: 'Past due', tone: 'attention' },
  canceled: { label: 'Canceled', tone: 'muted' },
  paid: { label: 'Paid', tone: 'ok' },
  granted: { label: 'Access granted', tone: 'ok' },
  pending: { label: 'Not paid yet', tone: 'muted' },
  payment_failed: { label: 'Payment failed', tone: 'attention' },
  expired: { label: 'Access ended', tone: 'muted' },
  revoked: { label: 'Access revoked', tone: 'muted' },
  refunded: { label: 'Refunded', tone: 'muted' },
  unknown: { label: 'Status from TGP', tone: 'muted' },
};

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CoachPackageSubscribersScreen({ navigation, route }: Props) {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
  const { packageId, title } = route.params;
  const [data, setData] = useState<PackageSubscribersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setUnavailable(null);
    try {
      const res = await coachPackagesApi.subscribers(packageId);
      setData(res.data);
    } catch (err) {
      if (errorStatus(err) === 404) {
        setUnavailable(
          'This package is no longer available. Go back to Packages and open it again.',
        );
        setData(null);
      } else {
        setError(errorMessage(err, 'Could not load subscribers.'));
      }
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMore = async () => {
    if (data?.nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const res = await coachPackagesApi.subscribers(packageId, data.nextOffset);
      setData({ ...res.data, subscribers: [...data.subscribers, ...res.data.subscribers] });
    } catch (err) {
      setError(errorMessage(err, 'The next clients could not be loaded. Tap Load more to try again.'));
    } finally {
      setLoadingMore(false);
    }
  };

  // COACH-INSETS-B-134 (B13 B28 B39): the shared Screen owns the status-bar
  // inset (Android edge-to-edge included); the tab bar owns the bottom.
  return (
    <Screen edges={['top']} scroll={false} contentStyle={styles.body} testID="coach-package-subscribers">
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={semanticColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={semanticColors.accent} />
        </View>
      ) : (
        <FlatList
          ListHeaderComponent={
            data ? (
              <View style={styles.summary}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{data.totalActive ?? 'Not available'}</Text>
                  <Text style={styles.summaryLabel}>Clients with access</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>
                    {data.monthlyRecurringRevenueCents !== null && data.currency
                      ? formatCurrencyCents(data.monthlyRecurringRevenueCents, data.currency)
                      : 'Not available'}
                  </Text>
                  <Text style={styles.summaryLabel}>MRR</Text>
                </View>
              </View>
            ) : null
          }
          data={data?.subscribers ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.content}
          ListFooterComponent={
            <View>
              {error && data?.subscribers.length ? <Text style={styles.emptyBody}>{error}</Text> : null}
              {data?.nextOffset != null ? (
                <TouchableOpacity onPress={() => void loadMore()} disabled={loadingMore}
                  accessibilityRole="button" accessibilityLabel="Load more clients">
                  <Text style={styles.emptyBody}>{loadingMore ? 'Loading clients' : 'Load more clients'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            unavailable ? (
              <View style={styles.emptyWrap}>
                <Ionicons
                  name="construct-outline"
                  size={28}
                  color={semanticColors.textMuted}
                />
                <Text style={styles.emptyTitle}>Not available</Text>
                <Text style={styles.emptyBody}>{unavailable}</Text>
              </View>
            ) : error ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="alert-circle-outline" size={28} color={tokens.colors.error} />
                <Text style={styles.emptyBody}>{error}</Text>
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={28} color={semanticColors.textMuted} />
                <Text style={styles.emptyTitle}>No subscribers yet</Text>
                <Text style={styles.emptyBody}>
                  Share this package's link to start enrolling clients.
                </Text>
              </View>
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={semanticColors.accent}
            />
          }
          renderItem={({ item }) => {
            const copy = STATUS_COPY[item.status];
            return (
              <View style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowName}>{item.name || item.email || 'Client'}</Text>
                  <Text style={styles.rowMeta}>
                    {item.entitlementActive ? 'Access active' : 'Access ended'}{' · '}
                    Started {formatDate(item.startedAt) ?? '—'}
                    {item.cancelAtPeriodEnd
                      ? ' · Renewal canceled'
                      : item.nextRenewalAt
                      ? ` · Renews ${formatDate(item.nextRenewalAt)}`
                      : ''}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <View
                    style={[
                      styles.pill,
                      copy.tone === 'ok' && styles.pillOk,
                      copy.tone === 'attention' && styles.pillAttention,
                      copy.tone === 'muted' && styles.pillMuted,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        copy.tone === 'ok' && { color: semanticColors.accent },
                        copy.tone === 'attention' && { color: tokens.semantic.warning.icon },
                        copy.tone === 'muted' && { color: semanticColors.textMuted },
                      ]}
                    >
                      {item.status === 'unknown'
                        ? `Status: ${item.rawStatus.replace(/_/g, ' ')}`
                        : copy.label}
                    </Text>
                  </View>
                  <Text style={styles.rowAmount}>
                    Package price {formatCurrencyCents(item.amountCents, item.currency)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    // The list keeps its own 16 pt sides and foot.
    body: { paddingHorizontal: 0, paddingBottom: 0 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    backBtn: { width: layout.touchMin, height: layout.touchMin, justifyContent: 'center', alignItems: 'center' },
    topTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '500',
      color: semanticColors.textPrimary,
    },
    loadingWrap: { paddingVertical: 60, alignItems: 'center' },
    content: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
    summary: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 12,
      marginBottom: 8,
    },
    summaryItem: {
      flex: 1,
      backgroundColor: semanticColors.bgSurface,
      borderRadius: radius.card,
      padding: 14,
      alignItems: 'center',
    },
    summaryValue: {
      fontSize: 20,
      fontWeight: '500',
      color: semanticColors.textPrimary,
    },
    summaryLabel: {
      fontSize: 11,
      color: semanticColors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 2,
    },
    row: {
      flexDirection: 'row',
      backgroundColor: semanticColors.bgSurface,
      borderRadius: radius.card,
      padding: 14,
      alignItems: 'center',
      gap: 12,
    },
    rowMain: { flex: 1 },
    rowName: { fontSize: 14, color: semanticColors.textPrimary, fontWeight: '500' },
    rowMeta: { fontSize: 12, color: semanticColors.textMuted, marginTop: 2 },
    rowRight: { alignItems: 'flex-end', gap: 4 },
    pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.chip },
    pillOk: { backgroundColor: tokens.brand[50] },
    pillAttention: { backgroundColor: tokens.semantic.warning.bg },
    pillMuted: { backgroundColor: semanticColors.bgSurface },
    pillText: { fontSize: 10, fontWeight: '500', textTransform: 'uppercase' },
    rowAmount: { fontSize: 12, color: semanticColors.textPrimary, fontWeight: '500' },
    emptyWrap: {
      paddingVertical: 60,
      alignItems: 'center',
      gap: 10,
    },
    emptyTitle: { fontSize: 16, fontWeight: '500', color: semanticColors.textPrimary },
    emptyBody: {
      fontSize: 13,
      color: semanticColors.textMuted,
      textAlign: 'center',
      paddingHorizontal: 24,
      lineHeight: 18,
    },
  });
