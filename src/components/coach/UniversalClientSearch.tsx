/**
 * UniversalClientSearch — Stage-3 reusable EHR-style client picker.
 *
 * One search component, three contexts:
 *
 *   1. Cross-pillar (default) — calls `crossPillarApi.search(q)` against
 *      `gpb /coach/cross-pillar/search`, which fans out to both the
 *      fitness Postgres and the finance backend and returns
 *      `CrossPillarSearchHit` rows with a `products` array.
 *   2. Fitness-only — pass `searchFn` to call the local fitness search.
 *   3. Finance-only — pass `searchFn` to call the finance coach API.
 *
 * Behaviour:
 *   - Live search with 200 ms debounce (configurable via `debounceMs`).
 *   - Empty query on focus shows the last five recently-viewed clients
 *     from local AsyncStorage. Tapping one calls `onSelect` and pushes
 *     it back onto the recent list (the host screen owns navigation).
 *   - Reduce-Motion–aware: skeletons (rather than a spinning indicator)
 *     so the row count stays visually stable while the network resolves.
 *   - Error state with retry — never silent.
 *
 * The component is presentational + dataFn-driven; it does not import
 * `crossPillarApi` directly so the same code can render any of the
 * three search contexts and so tests can pass a stub.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { Typography } from '../../theme';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  pushRecentClient,
  readRecentClients,
  RecentClient,
} from '../../lib/recentClients';

export interface UniversalSearchHit {
  email: string;
  name: string | null;
  pillars: ('fitness' | 'finance')[];
  /** Free-form context — e.g. "Sarah K. · 3 missed check-ins" */
  subtitle?: string | null;
}

export interface UniversalClientSearchProps {
  /** Network call to run for a non-empty query. Should never throw. */
  searchFn: (q: string) => Promise<UniversalSearchHit[]>;
  /** Called when the user taps a hit. Host owns navigation. */
  onSelect: (hit: UniversalSearchHit) => void;
  /** Placeholder text inside the input. */
  placeholder?: string;
  /** Disable the recent-on-focus affordance for contexts that don't want it. */
  showRecent?: boolean;
  /** Override the 200ms debounce. */
  debounceMs?: number;
  /** Test hook so unit tests can pre-populate the recent list. */
  initialRecent?: RecentClient[];
}

const DEFAULT_DEBOUNCE_MS = 200;

export function UniversalClientSearch({
  searchFn,
  onSelect,
  placeholder = 'Search clients — name, email, phone',
  showRecent = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  initialRecent,
}: UniversalClientSearchProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<UniversalSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentClient[]>(initialRecent ?? []);
  const [reduceMotion, setReduceMotion] = useState(false);

  const debouncedQuery = useDebouncedValue(query.trim(), debounceMs);

  // Keep the latest `searchFn` in a ref so callers passing inline arrow
  // functions don't re-trigger the search effect on every render.
  const searchFnRef = useRef(searchFn);
  useEffect(() => {
    searchFnRef.current = searchFn;
  }, [searchFn]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => setReduceMotion(!!v))
      .catch(() => setReduceMotion(false));
  }, []);

  // Load recent clients once on mount when the affordance is enabled.
  useEffect(() => {
    if (!showRecent || initialRecent) return;
    let alive = true;
    readRecentClients()
      .then((rows) => {
        if (alive) setRecent(rows);
      })
      .catch(() => {
        if (alive) setRecent([]);
      });
    return () => {
      alive = false;
    };
  }, [showRecent, initialRecent]);

  // Run the search when the debounced query changes. A trailing fetch
  // can resolve after a newer one — guard with a stale flag.
  useEffect(() => {
    if (!debouncedQuery) {
      setHits([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    searchFnRef
      .current(debouncedQuery)
      .then((rows) => {
        if (stale) return;
        setHits(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setError(toMessage(err));
        setHits([]);
        setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [debouncedQuery]);

  const handleSelect = useCallback(
    (hit: UniversalSearchHit) => {
      onSelect(hit);
      // Fire-and-forget cache update. We don't care about the result.
      pushRecentClient({
        email: hit.email,
        name: hit.name,
        pillars: hit.pillars,
      }).catch(() => {});
    },
    [onSelect],
  );

  const handleSelectRecent = useCallback(
    (r: RecentClient) => {
      handleSelect({
        email: r.email,
        name: r.name,
        pillars: r.pillars,
      });
    },
    [handleSelect],
  );

  const showRecentList = showRecent && focused && !query.trim() && recent.length > 0;
  const showResults = !!debouncedQuery && !loading && !error;
  const hasResults = showResults && hits.length > 0;
  const showEmpty = !!debouncedQuery && !loading && !error && hits.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search clients"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          returnKeyType="search"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Recent on focus */}
      {showRecentList ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RECENT</Text>
          <FlatList
            data={recent}
            keyExtractor={(r) => `recent-${r.email}`}
            renderItem={({ item }) => (
              <ResultRow
                colors={colors}
                styles={styles}
                title={item.name || item.email}
                subtitle={item.email}
                pillars={item.pillars}
                onPress={() => handleSelectRecent(item)}
              />
            )}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : null}

      {/* Loading skeleton */}
      {loading ? (
        <View style={styles.section}>
          {reduceMotion ? (
            <View style={styles.spinnerBlock}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : (
            <SearchSkeleton styles={styles} />
          )}
        </View>
      ) : null}

      {/* Error */}
      {error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => setQuery((q) => q + ' ')}
            accessibilityRole="button"
            accessibilityLabel="Retry search"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Empty result */}
      {showEmpty ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptyBody}>Try an email, phone, or a partial name.</Text>
        </View>
      ) : null}

      {/* Results */}
      {hasResults ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RESULTS</Text>
          <FlatList
            data={hits}
            keyExtractor={(h) => `hit-${h.email}`}
            renderItem={({ item }) => (
              <ResultRow
                colors={colors}
                styles={styles}
                title={item.name || item.email}
                subtitle={item.subtitle ?? item.email}
                pillars={item.pillars}
                onPress={() => handleSelect(item)}
              />
            )}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : null}
    </View>
  );
}

interface ResultRowProps {
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  title: string;
  subtitle: string | null;
  pillars: ('fitness' | 'finance')[];
  onPress: () => void;
}

function ResultRow({ colors, styles, title, subtitle, pillars, onPress }: ResultRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceElevated }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ''}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.badgeRow}>
        {pillars.includes('fitness') ? <PillarBadge label="BODY" colors={colors} /> : null}
        {pillars.includes('finance') ? <PillarBadge label="WEALTH" colors={colors} /> : null}
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
      <Text
        style={{
          ...Typography.label,
          fontSize: 10,
          letterSpacing: 1.4,
          color: colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function SearchSkeleton({
  styles,
}: {
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View>
      {[0, 1, 2].map((i) => (
        <View key={`sk-${i}`} style={styles.skeletonRow}>
          <View style={[styles.skeletonBlock, { width: '40%' }]} />
          <View style={[styles.skeletonBlock, styles.skeletonNarrow, { width: '70%' }]} />
        </View>
      ))}
    </View>
  );
}

function toMessage(err: unknown): string {
  if (!err) return 'Search failed.';
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? 'Search failed.');
  }
  return 'Search failed.';
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: 12,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: 4,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    input: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textPrimary,
      padding: 0,
    },
    section: {
      gap: 8,
    },
    sectionLabel: {
      ...Typography.label,
      color: colors.textMuted,
      letterSpacing: 1.5,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: colors.textPrimary,
    },
    rowSubtitle: {
      ...Typography.caption,
      color: colors.textMuted,
      marginTop: 2,
    },
    badgeRow: {
      flexDirection: 'row',
      gap: 6,
    },
    spinnerBlock: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    skeletonRow: {
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
      gap: 6,
    },
    skeletonBlock: {
      height: 12,
      borderRadius: 4,
      backgroundColor: colors.surfaceElevated,
    },
    skeletonNarrow: {
      height: 10,
    },
    errorBlock: {
      padding: 16,
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      borderRadius: 4,
    },
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.error,
    },
    retryText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: colors.primary,
    },
    emptyBlock: {
      paddingVertical: 24,
      alignItems: 'center',
      gap: 4,
    },
    emptyTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: colors.textPrimary,
    },
    emptyBody: {
      ...Typography.caption,
      color: colors.textMuted,
    },
  });
