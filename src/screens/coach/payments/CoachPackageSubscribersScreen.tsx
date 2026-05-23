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
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { formatCurrencyCents } from '../../../utils/currency';

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
};

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CoachPackageSubscribersScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { packageId, title } = route.params;
  const [data, setData] = useState<PackageSubscribersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    setUnavailable(null);
    try {
      const res = await coachPackagesApi.subscribers(packageId);
      setData(res.data);
    } catch (err) {
      // 404 here means the endpoint is not deployed in this environment
      // (Wave 4 backend dependency). Surface it honestly — collapsing 404
      // to an empty list would lie to the coach as "0 subscribers".
      if (errorStatus(err) === 404) {
        setUnavailable(
          'Subscriber reporting is not available in this environment yet. It will appear once the marketplace backend ships.',
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

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ListHeaderComponent={
            data ? (
              <View style={styles.summary}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{data.totalActive}</Text>
                  <Text style={styles.summaryLabel}>Active</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>
                    {formatCurrencyCents(data.monthlyRecurringRevenueCents, 'usd')}
                  </Text>
                  <Text style={styles.summaryLabel}>MRR</Text>
                </View>
              </View>
            ) : null
          }
          data={data?.subscribers ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.content}
          ListEmptyComponent={
            unavailable ? (
              <View style={styles.emptyWrap}>
                <Ionicons
                  name="construct-outline"
                  size={28}
                  color={colors.textMuted}
                />
                <Text style={styles.emptyTitle}>Not available</Text>
                <Text style={styles.emptyBody}>{unavailable}</Text>
              </View>
            ) : error ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
                <Text style={styles.emptyBody}>{error}</Text>
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={28} color={colors.textMuted} />
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
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => {
            const copy = STATUS_COPY[item.status];
            return (
              <View style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowName}>{item.name || item.email}</Text>
                  <Text style={styles.rowMeta}>
                    Started {formatDate(item.startedAt) ?? '—'}
                    {item.nextRenewalAt
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
                        copy.tone === 'ok' && { color: colors.primary },
                        copy.tone === 'attention' && { color: colors.warning },
                        copy.tone === 'muted' && { color: colors.textMuted },
                      ]}
                    >
                      {copy.label}
                    </Text>
                  </View>
                  <Text style={styles.rowAmount}>
                    {formatCurrencyCents(item.totalPaidCents, 'usd')}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    topTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
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
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      alignItems: 'center',
    },
    summaryValue: {
      fontSize: 20,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    summaryLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 2,
    },
    row: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      alignItems: 'center',
      gap: 12,
    },
    rowMain: { flex: 1 },
    rowName: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
    rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    rowRight: { alignItems: 'flex-end', gap: 4 },
    pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
    pillOk: { backgroundColor: colors.primaryPale },
    pillAttention: { backgroundColor: colors.noticeWarningIconBg },
    pillMuted: { backgroundColor: colors.surfaceElevated },
    pillText: { fontSize: 10, fontWeight: '500', textTransform: 'uppercase' },
    rowAmount: { fontSize: 12, color: colors.textPrimary, fontWeight: '500' },
    emptyWrap: {
      paddingVertical: 60,
      alignItems: 'center',
      gap: 10,
    },
    emptyTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
    emptyBody: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 24,
      lineHeight: 18,
    },
  });
