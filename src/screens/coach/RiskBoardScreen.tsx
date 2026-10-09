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
} from 'react-native';
import { SkeletonList } from '../../ui/skeletons/Skeleton';
import { QuietError, QuietLoading, loadFailureMessage } from '../../ui/states/QuietStates';
import HapticPressable from '../../components/HapticPressable';
import RiskDot from '../../components/RiskDot';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { radius } from '../../theme/tokens';
import { Screen } from '../../ui';
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
        // AUDIT-13-125: /admin/ptm/* also needs the server service token, so
        // an app session can never read it; the owner account reads its own
        // roster through the coach endpoint like every coach.
        const res = await ptmApi.getMyRiskBoard({
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
        // QA-COACH-STATES-131: words only, never the raw error text.
        setError(loadFailureMessage(err, 'The risk board'));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [cursor],
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
      <Screen edges={['top']} scroll={false} contentStyle={styles.bare} testID="risk-board">
        <View style={styles.header}>
          <Text style={styles.title}>Risk Board</Text>
        </View>
        <View style={styles.placeholder} testID="risk-board-locked">
          <Text style={styles.placeholderTitle}>Restricted</Text>
          <Text style={styles.placeholderBody}>
            The risk board is available to coaches and the operator account.
          </Text>
        </View>
      </Screen>
    );
  }

  const filters: Filter[] = ['all', 'red', 'amber', 'green'];

  const renderItem = ({ item }: { item: RiskBoardEntry }) => (
    <HapticPressable
      intent="light"
      style={styles.row}
      onPress={() =>
        // AUDIT-13-125: the risk detail screen reads an owner-only admin
        // route and always failed; open the client's own page instead.
        navigation.navigate('ClientDetail', {
          clientId: item.user_id,
          clientName: item.name,
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}`}
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
    <Screen edges={['top']} scroll={false} contentStyle={styles.bare} testID="risk-board">
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
        <SkeletonList count={7} />
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
            error ? (
              <QuietError
                message={error}
                onRetry={() => void fetchPage('initial', filter)}
                retryHint="Loads the risk board again"
                testID="risk-board-error"
              />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No risk data yet</Text>
                <Text style={styles.emptyBody}>
                  Risk levels update every night once clients start logging.
                </Text>
              </View>
            )
          }
          ListFooterComponent={
            loadingMore ? <QuietLoading label="Loading more clients" rows={1} /> : null
          }
        />
      )}
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // Screen (src/ui) owns the top: insets.top + 12, never a fixed 60 (B13 B28).
    bare: { paddingHorizontal: 0, paddingBottom: 0 },
    header: {
      paddingHorizontal: 24,
      paddingTop: 12,
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
      borderRadius: radius.chip,
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
      borderRadius: radius.card,
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
