// PTM Phase 1E — Coach Risk Board
//
// Lists clients sorted by risk_score DESC. Server-side filter (?bucket=).
// Cursor-paginated; pull-to-refresh.
//
// Role gating:
//   - role==='owner'  → fetches /admin/ptm/risk-board (platform-wide,
//     numeric percentage rendered alongside the bucket dot).
//   - role==='coach'  → fetches /coach/clients/risk-board (own roster
//     only; backend redacts risk_score/success_score so the UI shows
//     bucket-only and hides the percentage column).
//   - role==='student' is locked out by RootNavigator long before this
//     screen mounts. The explicit check below is a doctrine belt-and-braces:
//     PTM scores must NEVER reach a student device.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import RiskDot from '../../components/RiskDot';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { ptmApi, RiskBoardEntry } from '../../services/ptmApi';
import type { PtmRiskBucket } from '../../types/ptm';

type Filter = 'all' | PtmRiskBucket;

const PAGE_SIZE = 20;

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export default function RiskBoardScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const isOwner = currentUser?.role === 'owner';
  const isCoach = currentUser?.role === 'coach';
  // The screen renders the data path for both owner and coach. Anything
  // else (no role yet, student) gets the locked screen.
  const canViewBoard = isOwner || isCoach;

  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<RiskBoardEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (mode: 'initial' | 'refresh' | 'next', activeFilter: Filter) => {
      try {
        const bucket = activeFilter === 'all' ? undefined : activeFilter;
        const useCursor = mode === 'next' ? cursor ?? undefined : undefined;
        if (mode === 'initial') setLoading(true);
        if (mode === 'refresh') setRefreshing(true);
        if (mode === 'next') setLoadingMore(true);
        // Owner reads the platform-wide /admin endpoint. Coaches read the
        // coach-scoped endpoint, which is roster-filtered and redacts the
        // numeric score on the server.
        const fetcher = isOwner ? ptmApi.getRiskBoard : ptmApi.getMyRiskBoard;
        const res = await fetcher({
          bucket,
          cursor: useCursor,
          limit: PAGE_SIZE,
        });
        setError(null);
        setCursor(res.data.next_cursor ?? null);
        setItems((prev) =>
          mode === 'next' ? [...prev, ...res.data.items] : res.data.items,
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not load the risk board.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [cursor, isOwner],
  );

  useEffect(() => {
    if (!canViewBoard) return;
    setItems([]);
    setCursor(null);
    fetchPage('initial', filter);
    // We intentionally re-fetch on filter change; cursor resets above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, canViewBoard]);

  const onRefresh = useCallback(() => {
    setCursor(null);
    fetchPage('refresh', filter);
  }, [fetchPage, filter]);

  const onEndReached = useCallback(() => {
    if (loadingMore || !cursor) return;
    fetchPage('next', filter);
  }, [cursor, fetchPage, filter, loadingMore]);

  if (!canViewBoard) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Risk Board</Text>
        </View>
        <View style={styles.placeholder} testID="risk-board-locked">
          <Text style={styles.placeholderTitle}>Restricted</Text>
          <Text style={styles.placeholderBody}>
            The risk board is available to coaches and the operator account.
          </Text>
        </View>
      </View>
    );
  }

  const filters: Filter[] = ['all', 'red', 'amber', 'green'];

  const renderItem = ({ item }: { item: RiskBoardEntry }) => (
    <HapticPressable
      intent="light"
      style={styles.row}
      onPress={() =>
        navigation.navigate('ClientRiskDetail', {
          userId: item.user_id,
          clientName: item.name,
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Open risk detail for ${item.name}`}
    >
      <RiskDot bucket={item.bucket} size={12} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowEmail} numberOfLines={1}>
          {item.email}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        {/*
         * Owner sees the raw percentage; coaches see only the bucket
         * label (the backend redacts risk_score for non-owners as
         * Phase 1E doctrine).
         */}
        {item.risk_score == null ? (
          <Text style={styles.rowBucket}>
            {item.bucket.charAt(0).toUpperCase() + item.bucket.slice(1)}
          </Text>
        ) : (
          <Text style={styles.rowScore}>{Math.round(item.risk_score * 100)}%</Text>
        )}
        <Text style={styles.rowSignal}>{formatRelative(item.last_signal_at)}</Text>
      </View>
    </HapticPressable>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Risk Board</Text>
        <Text style={styles.subtitle}>Sorted by churn risk</Text>
      </View>

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <HapticPressable
            key={f}
            intent="light"
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
            accessibilityRole="button"
            accessibilityLabel={`Filter ${f}`}
            accessibilityState={{ selected: filter === f }}
            testID={`risk-filter-${f}`}
          >
            <Text
              style={[
                styles.filterChipText,
                filter === f && styles.filterChipTextActive,
              ]}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </HapticPressable>
        ))}
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={styles.loader}
        />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {error ? 'Could not load risk data' : 'No risk data yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {error
                  ? error
                  : 'Recompute runs nightly at 04:00 UTC.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={styles.footerLoader}
              />
            ) : null
          }
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: 60,
    },
    header: {
      paddingHorizontal: 24,
      marginBottom: 16,
    },
    title: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      color: colors.textPrimary,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 4,
    },
    filterRow: {
      flexDirection: 'row',
      paddingHorizontal: 24,
      gap: 8,
      marginBottom: 16,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterChipText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: colors.textSecondary,
    },
    filterChipTextActive: {
      color: colors.textOnPrimary,
    },
    listContent: {
      paddingHorizontal: 24,
      paddingBottom: 100,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 16,
      marginBottom: 10,
      gap: 12,
    },
    rowBody: {
      flex: 1,
      gap: 2,
    },
    rowName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
      color: colors.textPrimary,
    },
    rowEmail: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
    },
    rowMeta: {
      alignItems: 'flex-end',
      gap: 2,
    },
    rowScore: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
      color: colors.textPrimary,
    },
    rowBucket: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: colors.textPrimary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    rowSignal: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
    },
    loader: { marginTop: 40 },
    footerLoader: { paddingVertical: 16 },
    empty: {
      paddingTop: 60,
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
      color: colors.textPrimary,
    },
    emptyBody: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    placeholder: {
      flex: 1,
      paddingHorizontal: 32,
      paddingTop: 80,
      alignItems: 'center',
      gap: 8,
    },
    placeholderTitle: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 24,
      color: colors.textPrimary,
    },
    placeholderBody: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
