/**
 * ExerciseLibraryScreen — v1 exercise catalog browser.
 *
 * Backed by the new `/exercise-catalog` endpoint (PR
 * `feat/video-library-v1-backend`). Lives under `src/screens/client/`
 * because the workout flows that consume it (ActiveWorkout, viewer)
 * are already in the client navigator; a coach-side entry can be
 * added later by wiring this screen into the coach Templates stack
 * (no fork required).
 *
 * Scope kept deliberately scrappy for v1:
 *   - Search bar (debounce-free; refetch on submit).
 *   - Horizontal chip filters for category / primary muscle /
 *     equipment, using the lightweight facets we ship hardcoded
 *     below. The backend accepts free-text values, so adding more
 *     chips later is purely additive.
 *   - Infinite scroll via the response's `nextCursor`.
 *   - No filter modal, no thumbnail grid, no offline mirror.
 *
 * Tap a row → ExerciseDetail with the exercise id.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { exerciseCatalogApi } from '../../api/exerciseCatalog';
import type {
  Exercise,
  ExerciseListParams,
  ExerciseListResponse,
} from '../../types/exerciseCatalog';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';

// ── Filter facets (v1, hardcoded) ────────────────────────────────────────────
// These mirror the most common values seeded into the backend catalog by the
// `feat/video-library-v1-backend` Wger importer. They're intentionally short:
// v1 only needs to feel useful, not exhaustive. Power-users still have the
// free-text search bar.
const CATEGORY_CHIPS = ['strength', 'cardio', 'mobility', 'core'] as const;
const MUSCLE_CHIPS = [
  'chest',
  'back',
  'legs',
  'shoulders',
  'arms',
  'glutes',
] as const;
const EQUIPMENT_CHIPS = ['barbell', 'dumbbell', 'bodyweight', 'machine'] as const;

type Props = NativeStackScreenProps<WorkoutStackParamList, 'ExerciseLibrary'>;

export default function ExerciseLibraryScreen({ navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [primaryMuscle, setPrimaryMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);

  const [items, setItems] = useState<Exercise[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const buildParams = useCallback(
    (next: string | null): ExerciseListParams => ({
      q: submittedSearch || undefined,
      category: category ?? undefined,
      primaryMuscle: primaryMuscle ?? undefined,
      equipment: equipment ?? undefined,
      cursor: next ?? undefined,
      limit: 20,
    }),
    [submittedSearch, category, primaryMuscle, equipment],
  );

  const fetchPage = useCallback(
    async (mode: 'replace' | 'append') => {
      if (loading) return;
      setLoading(true);
      setError(null);
      try {
        const nextCursor = mode === 'append' ? cursor : null;
        const res = await exerciseCatalogApi.list(buildParams(nextCursor));
        const body = res.data as ExerciseListResponse;
        setItems((prev) =>
          mode === 'append' ? [...prev, ...body.items] : body.items,
        );
        setCursor(body.nextCursor);
        setExhausted(body.nextCursor === null);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Could not load exercises.',
        );
      } finally {
        setLoading(false);
      }
    },
    [buildParams, cursor, loading],
  );

  // Re-fetch the first page whenever filters or submitted search change.
  // Using a key effect rather than useQuery to keep dependencies minimal.
  const filterKey = `${submittedSearch}|${category}|${primaryMuscle}|${equipment}`;
  React.useEffect(() => {
    setCursor(null);
    setExhausted(false);
    void fetchPage('replace');
    // We intentionally exclude fetchPage from deps; the params bake in via
    // buildParams referenced inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const onSubmitSearch = useCallback(() => {
    setSubmittedSearch(search.trim());
  }, [search]);

  const onEndReached = useCallback(() => {
    if (!loading && !exhausted && cursor) {
      void fetchPage('append');
    }
  }, [loading, exhausted, cursor, fetchPage]);

  const renderChipRow = useCallback(
    (
      label: string,
      values: readonly string[],
      selected: string | null,
      setSelected: (v: string | null) => void,
    ) => (
      <View style={styles.chipRow}>
        <Text style={styles.chipRowLabel}>{label}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScrollContent}
        >
          {values.map((v) => {
            const active = selected === v;
            return (
              <Pressable
                key={v}
                onPress={() => setSelected(active ? null : v)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.chipText,
                    active && styles.chipTextActive,
                  ]}
                >
                  {v}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    ),
    [styles],
  );

  const renderItem = useCallback(
    ({ item }: { item: Exercise }) => (
      <Pressable
        onPress={() =>
          navigation.navigate('ExerciseDetail', { idOrSlug: item.id })
        }
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name}`}
      >
        <Text style={styles.rowName}>{item.name}</Text>
        <Text style={styles.rowMeta}>
          {[item.primaryMuscle, item.category, item.difficulty]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Pressable>
    ),
    [navigation, styles],
  );

  return (
    <View style={styles.screen} testID="exercise-library-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Exercise Library</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search exercises"
          placeholderTextColor={sc.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          onSubmitEditing={onSubmitSearch}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search exercises"
        />
        {renderChipRow('Category', CATEGORY_CHIPS, category, setCategory)}
        {renderChipRow(
          'Muscle',
          MUSCLE_CHIPS,
          primaryMuscle,
          setPrimaryMuscle,
        )}
        {renderChipRow(
          'Equipment',
          EQUIPMENT_CHIPS,
          equipment,
          setEquipment,
        )}
      </View>

      {error ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !loading && !error ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No exercises match.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          loading ? (
            <View style={styles.footerWrap}>
              <ActivityIndicator color={sc.accent} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: sc.bgPrimary,
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    title: {
      ...typography.h2,
      color: sc.textPrimary,
      marginBottom: spacing.md,
    },
    searchInput: {
      ...typography.body,
      color: sc.textPrimary,
      backgroundColor: sc.bgSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
      borderRadius: 10,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
    },
    chipRow: {
      marginTop: spacing.sm,
    },
    chipRowLabel: {
      ...typography.eyebrow,
      color: sc.textMuted,
      marginBottom: spacing.xs,
    },
    chipScrollContent: {
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
      borderRadius: 999,
      backgroundColor: sc.bgSurface,
    },
    chipActive: {
      borderColor: sc.accent,
      backgroundColor: sc.accent,
    },
    chipText: {
      ...typography.bodySmall,
      color: sc.textPrimary,
      textTransform: 'capitalize',
    },
    chipTextActive: {
      color: sc.bgSurface,
    },
    listContent: {
      paddingBottom: spacing.xl,
    },
    row: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    rowName: {
      ...typography.h4,
      color: sc.textPrimary,
    },
    rowMeta: {
      ...typography.bodySmall,
      color: sc.textMuted,
      marginTop: 2,
      textTransform: 'capitalize',
    },
    emptyWrap: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      alignItems: 'center',
    },
    emptyText: {
      ...typography.body,
      color: sc.textMuted,
    },
    errorText: {
      ...typography.body,
      color: sc.accent,
    },
    footerWrap: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
  });
}
