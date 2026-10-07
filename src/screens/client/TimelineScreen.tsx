/**
 * TimelineScreen.tsx — Phase 7B: Transformation Timeline
 *
 * A reverse-chronological 4-lane record of a client's full journey.
 *
 * DESIGN DOCTRINE:
 *   - Cormorant Garamond for display/section headers.
 *   - Inter for body copy.
 *   - Bone/cream/ink/forest palette from src/theme/tokens.ts.
 *   - NO emoji. NO inline magic colors. All color references via tokens.
 *   - Lane dots use 4 distinct palette colors.
 *
 * LANES:
 *   Body     — #2C4A36 (forest)
 *   Win      — #C5A253 (mutedGold)
 *   Coach    — #1A1A18 (ink)
 *   Friction — #B1A89F (stone)
 */
import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  AccessibilityInfo,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, type SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { timelineApi, fetchTimeline, TimelineEvent, TimelineLane } from '../../services/timelineApi';

// ─── Lane configuration ───────────────────────────────────────────────────────

const LANE_CONFIG: Record<
  TimelineLane,
  { label: string; accessibilityLabel: string }
> = {
  body:     { label: 'Body', accessibilityLabel: 'Body lane' },
  win:      { label: 'Wins', accessibilityLabel: 'Wins lane' },
  coach:    { label: 'Coach', accessibilityLabel: 'Coach lane' },
  friction: { label: 'Friction', accessibilityLabel: 'Friction lane' },
};

const ALL_LANES: TimelineLane[] = ['body', 'win', 'coach', 'friction'];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FetchState {
  events: TimelineEvent[];
  nextCursor: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isFetchingMore: boolean;
  error: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

function useTimeline(activeLanes: TimelineLane[]) {
  const [state, setState] = useState<FetchState>({
    events: [],
    nextCursor: null,
    isLoading: true,
    isRefreshing: false,
    isFetchingMore: false,
    error: null,
  });

  const activeRef = useRef(true);

  const load = useCallback(
    async (cursor?: string, refresh = false) => {
      if (refresh) {
        setState((s) => ({ ...s, isRefreshing: true, error: null }));
      } else if (!cursor) {
        setState((s) => ({ ...s, isLoading: true, error: null }));
      } else {
        setState((s) => ({ ...s, isFetchingMore: true, error: null }));
      }

      try {
        const result = await fetchTimeline({
          sinceDays: 365,
          lanes: activeLanes.length === 4 ? undefined : activeLanes,
          cursor,
          limit: 20,
        });

        if (!activeRef.current) return;

        setState((s) => ({
          events: cursor ? [...s.events, ...result.events] : result.events,
          nextCursor: result.nextCursor,
          isLoading: false,
          isRefreshing: false,
          isFetchingMore: false,
          error: null,
        }));
      } catch (err) {
        if (!activeRef.current) return;
        setState((s) => ({
          ...s,
          isLoading: false,
          isRefreshing: false,
          isFetchingMore: false,
          error: 'Unable to load timeline. Check your connection and try again.',
        }));
      }
    },
    [activeLanes],
  );

  const refresh = useCallback(() => load(undefined, true), [load]);
  const loadMore = useCallback(() => {
    if (state.nextCursor && !state.isFetchingMore) {
      load(state.nextCursor);
    }
  }, [load, state.nextCursor, state.isFetchingMore]);

  React.useEffect(() => {
    activeRef.current = true;
    setState((s) => ({
      ...s,
      events: [],
      nextCursor: null,
      isLoading: true,
      error: null,
    }));
    load();
    return () => {
      activeRef.current = false;
    };
  }, [activeLanes.join(',')]);

  return { state, refresh, loadMore };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LaneDot({ lane }: { lane: TimelineLane }) {
  const { semanticColors } = useTheme();
  const styles = makeStyles(semanticColors);
  const { accessibilityLabel } = LANE_CONFIG[lane];
  return (
    <View
      style={[styles.laneDot, { backgroundColor: semanticColors.textMuted }]}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
    />
  );
}

function FilterChip({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const styles = makeStyles(useTheme().semanticColors);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterChip, active && styles.filterChipActive]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function EventCard({ event }: { event: TimelineEvent }) {
  const styles = makeStyles(useTheme().semanticColors);
  const cfg = LANE_CONFIG[event.lane];

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${cfg.accessibilityLabel}: ${event.title}. ${formatDate(event.at)}`}
    >
      <View style={styles.cardLeft}>
        <LaneDot lane={event.lane} />
        <View style={styles.cardConnector} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardDate} accessibilityElementsHidden>
          {cfg.label} · {formatDate(event.at)}
        </Text>
        <Text style={styles.cardTitle}>{event.title}</Text>
        {event.body ? (
          <Text style={styles.cardBodyText}>{event.body}</Text>
        ) : null}
      </View>
    </View>
  );
}

function EmptyState() {
  const styles = makeStyles(useTheme().semanticColors);
  return (
    <View style={styles.emptyState} accessible accessibilityLiveRegion="polite">
      <Text style={styles.emptyStateTitle}>No entries yet</Text>
      <Text style={styles.emptyStateBody}>
        No entries match these filters.
      </Text>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const styles = makeStyles(useTheme().semanticColors);
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>Could not load timeline</Text>
      <Text style={styles.emptyStateBody}>{message}</Text>
      <TouchableOpacity
        style={styles.retryButton}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry loading timeline"
      >
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TimelineScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const insets = useSafeAreaInsets();
  const [activeLanes, setActiveLanes] = useState<TimelineLane[]>(ALL_LANES);
  const { state, refresh, loadMore } = useTimeline(activeLanes);

  const toggleLane = useCallback((lane: TimelineLane) => {
    setActiveLanes((current) => {
      if (current.length === 4) {
        // From "All" — select just this lane.
        return [lane];
      }
      if (current.includes(lane)) {
        // Deselect — if this was the last one, revert to All.
        const next = current.filter((l) => l !== lane);
        return next.length === 0 ? ALL_LANES : next;
      }
      const next = [...current, lane];
      return next.length === 4 ? ALL_LANES : next;
    });
  }, []);

  const isAll = activeLanes.length === 4;

  const renderItem = useCallback(
    ({ item }: { item: TimelineEvent }) => <EventCard event={item} />,
    [],
  );

  const keyExtractor = useCallback((item: TimelineEvent) => item.id, []);

  const ListFooter = () => {
    if (!state.isFetchingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={sc.textMuted} />
      </View>
    );
  };

  if (state.isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Text style={styles.screenTitle}>Timeline</Text>
        <SkeletonScreen count={8} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.screenTitle} accessibilityRole="header">
          Timeline
        </Text>
      </View>

      {/* Lane filter chips */}
      <View
        style={styles.filterRow}
        accessibilityRole="toolbar"
        accessibilityLabel="Filter timeline by lane"
      >
        <FilterChip
          label="All"
          active={isAll}
          onPress={() => setActiveLanes(ALL_LANES)}
          accessibilityLabel="Show all lanes"
        />
        {ALL_LANES.map((lane) => (
          <FilterChip
            key={lane}
            label={LANE_CONFIG[lane].label}
            active={!isAll && activeLanes.includes(lane)}
            onPress={() => toggleLane(lane)}
            accessibilityLabel={`Filter to ${LANE_CONFIG[lane].label} lane`}
          />
        ))}
      </View>

      {/* Content */}
      {state.error ? (
        <ErrorState message={state.error} onRetry={refresh} />
      ) : (
        <FlatList
          data={state.events}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListEmptyComponent={EmptyState}
          ListFooterComponent={ListFooter}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          onRefresh={refresh}
          refreshing={state.isRefreshing}
          refreshControl={
            <RefreshControl
              refreshing={state.isRefreshing}
              onRefresh={refresh}
              tintColor={sc.textMuted}
              accessibilityLabel="Pull to refresh timeline"
            />
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
          accessibilityLabel="Transformation timeline"
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (sc: SemanticTokens) => {
  const colors = { bone: sc.bgPrimary, ink: sc.textPrimary, charcoal: sc.textMuted, stone: sc.border };
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  screenTitle: {
    ...typography.h1,
    color: colors.ink,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stone,
    backgroundColor: 'transparent',
  },
  filterChipActive: {
    borderBottomWidth: 2,
    borderColor: colors.ink,
  },
  filterChipText: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
  filterChipTextActive: {
    color: colors.ink,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  card: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  cardLeft: {
    alignItems: 'center',
    width: 24,
    marginRight: spacing.lg,
  },
  laneDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  cardConnector: {
    flex: 1,
    width: 1,
    backgroundColor: colors.stone,
    marginTop: spacing.xs,
    opacity: 0.4,
  },
  cardBody: {
    flex: 1,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.stone,
  },
  cardDate: {
    ...typography.bodySmall,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    ...typography.h4,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  cardBodyText: {
    ...typography.bodySmall,
    color: colors.charcoal,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['4xl'],
  },
  emptyStateTitle: {
    ...typography.h3,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptyStateBody: {
    ...typography.body,
    color: colors.charcoal,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
    minHeight: 44,
    borderRadius: 4,
    backgroundColor: sc.accent,
  },
  retryButtonText: {
    ...typography.bodySmall,
    color: sc.textOnAccent,
  },
  footerLoader: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
};
