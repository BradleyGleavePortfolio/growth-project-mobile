/**
 * CrossPillarClientsListScreen — EHR-style universal client list.
 *
 * Composes:
 *   - `<UniversalClientSearch />` for live federated search across both
 *     products. The hits surface immediately with pillar badges.
 *   - The full coach roster from `crossPillarApi.getClients` underneath,
 *     filterable by which pillars they engage in.
 *
 * Routing param `focus: 'search'` (passed from the home screen's
 * "Universal search" tile) auto-focuses the search input on mount.
 *
 * Tap behaviour: any row — recent, search hit, or roster — pushes the
 * `CrossPillarClientDetail` screen with the email as the identity key.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { crossPillarApi } from '../../../services/api';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { Typography } from '../../../theme';
import {
  UniversalClientSearch,
  UniversalSearchHit,
} from '../../../components/coach/UniversalClientSearch';
import type {
  CrossPillarRosterResponse,
  CrossPillarRosterRow,
  CrossPillarSearchHit,
} from '../../../types/crossPillar';
import type { CrossPillarStackParamList } from './CrossPillarNavigator';

type Nav = NativeStackNavigationProp<CrossPillarStackParamList, 'CrossPillarClients'>;

type Filter = 'all' | 'both' | 'fitness_only' | 'finance_only';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',            label: 'All' },
  { id: 'both',           label: 'Both' },
  { id: 'fitness_only',   label: 'Body only' },
  { id: 'finance_only',   label: 'Wealth only' },
];

export default function CrossPillarClientsListScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();

  const [roster, setRoster] = useState<CrossPillarRosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const loadRoster = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data } = await crossPillarApi.getClients();
      setRoster(data);
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRoster('initial');
  }, [loadRoster]);

  const filtered = useMemo(() => {
    if (!roster) return [];
    if (filter === 'all') return roster.results;
    if (filter === 'both') {
      return roster.results.filter((r) => r.pillars.length === 2);
    }
    if (filter === 'fitness_only') {
      return roster.results.filter(
        (r) => r.pillars.includes('fitness') && !r.pillars.includes('finance'),
      );
    }
    return roster.results.filter(
      (r) => r.pillars.includes('finance') && !r.pillars.includes('fitness'),
    );
  }, [roster, filter]);

  const goDetail = useCallback(
    (email: string, name: string | null) => {
      navigation.navigate('CrossPillarClientDetail', {
        email,
        name: name ?? email,
      });
    },
    [navigation],
  );

  // Adapter: the universal search component expects `UniversalSearchHit`,
  // so we map the federated `CrossPillarSearchHit` shape into it once.
  const searchAdapter = useCallback(async (q: string): Promise<UniversalSearchHit[]> => {
    const { data } = await crossPillarApi.search(q, 25);
    return data.results.map<UniversalSearchHit>((h: CrossPillarSearchHit) => ({
      email: h.email,
      name: h.name,
      pillars: h.products,
    }));
  }, []);

  return (
    <View style={styles.safe}>
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>UNIVERSAL ROSTER</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.searchSection}>
        <UniversalClientSearch
          searchFn={searchAdapter}
          onSelect={(hit) => goDetail(hit.email, hit.name)}
          placeholder="Search by name, email, or phone"
        />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter: ${f.label}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Couldn't load roster</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={() => loadRoster('initial')} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyTitle}>
            {roster?.results.length === 0 ? 'No clients yet' : 'No matches'}
          </Text>
          <Text style={styles.emptyBody}>
            {roster?.results.length === 0
              ? 'Your roster will populate as clients sign up under your invite codes.'
              : 'Try a different filter or use the search bar above.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => `roster-${r.email}`}
          renderItem={({ item }) => (
            <RosterRow
              item={item}
              styles={styles}
              colors={colors}
              onPress={() => goDetail(item.email, item.name)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadRoster('refresh')}
              tintColor={colors.textSecondary}
            />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function RosterRow({
  item,
  styles,
  colors,
  onPress,
}: {
  item: CrossPillarRosterRow;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  onPress: () => void;
}) {
  const subtitle = describeFinance(item);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceElevated }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.name ?? item.email}, ${item.pillars.join(' and ')}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name ?? item.email}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.badgeRow}>
        {item.pillars.includes('fitness') ? (
          <PillarBadge label="BODY" colors={colors} />
        ) : null}
        {item.pillars.includes('finance') ? (
          <PillarBadge label="WEALTH" colors={colors} />
        ) : null}
      </View>
    </Pressable>
  );
}

function PillarBadge({ label, colors }: { label: string; colors: ThemeColors }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 0.5,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ ...Typography.label, fontSize: 10, letterSpacing: 1.4, color: colors.textSecondary }}>
        {label}
      </Text>
    </View>
  );
}

function describeFinance(row: CrossPillarRosterRow): string {
  if (row.finance.status === 'ok' && row.finance.summary) {
    const s = row.finance.summary;
    if (typeof s.net_worth === 'number') {
      return `${row.email} · NW ${formatMoney(s.net_worth)}`;
    }
    return row.email;
  }
  if (row.finance.status === 'not_found') return `${row.email} · body only`;
  return `${row.email} · wealth unavailable`;
}

function formatMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function toMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? 'Something went wrong.');
  }
  return 'Something went wrong.';
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 8,
    },
    backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', ...Typography.label, color: colors.textSecondary },
    searchSection: { paddingHorizontal: 16, paddingBottom: 8 },
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: 999,
      backgroundColor: colors.surface,
    },
    chipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryPale ?? colors.surface,
    },
    chipText: { ...Typography.caption, color: colors.textSecondary },
    chipTextActive: { color: colors.primary },
    loadingBlock: { paddingVertical: 48, alignItems: 'center' },
    emptyBlock: {
      alignItems: 'center',
      paddingVertical: 64,
      paddingHorizontal: 24,
      gap: 8,
    },
    emptyTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    emptyBody: { ...Typography.caption, color: colors.textMuted, textAlign: 'center' },
    errorBlock: {
      margin: 16,
      padding: 16,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      gap: 8,
    },
    errorTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    errorBody: { ...Typography.caption, color: colors.textMuted },
    retryText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.primary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowName: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    rowSubtitle: { ...Typography.caption, color: colors.textMuted, marginTop: 2 },
    badgeRow: { flexDirection: 'row', gap: 6 },
  });
