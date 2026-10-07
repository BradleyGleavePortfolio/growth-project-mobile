/**
 * ExerciseLibraryScreen — client exercise library browser.
 *
 * Lists GET /exercises/search (the ExerciseDB proxy the coach builder
 * uses) through exerciseCatalogApi.browse; the /exercise-catalog table
 * has no rows in production. Detail still tries the catalog first and
 * falls back to /exercises/:id.
 *
 *   - Search on submit.
 *   - Two text-filter rows: body part and equipment (values the live
 *     source answers). Free-text search covers everything else.
 *   - Cursor pagination for the unfiltered list.
 *
 * Tap a row → ExerciseDetail with the exercise id.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import HapticPressable from '../../components/HapticPressable';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';

// ── Filter facets ────────────────────────────────────────────────────────────
// Body part and equipment values the ExerciseDB proxy filters on.
const BODY_PART_CHIPS = [
  'chest',
  'back',
  'shoulders',
  'upper arms',
  'upper legs',
  'lower legs',
  'waist',
  'cardio',
] as const;
const EQUIPMENT_CHIPS = [
  'barbell',
  'dumbbell',
  'body weight',
  'cable',
  'kettlebell',
  'leverage machine',
] as const;

type Props = NativeStackScreenProps<WorkoutStackParamList, 'ExerciseLibrary'>;

export default function ExerciseLibraryScreen({ navigation }: Props) {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
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
      equipment: equipment ?? undefined,
      cursor: next ?? undefined,
    }),
    [submittedSearch, category, equipment],
  );

  const fetchPage = useCallback(
    async (mode: 'replace' | 'append') => {
      if (loading) return;
      setLoading(true);
      setError(null);
      try {
        const nextCursor = mode === 'append' ? cursor : null;
        const res = await exerciseCatalogApi.browse(buildParams(nextCursor));
        const body = res.data as ExerciseListResponse;
        setItems((prev) =>
          mode === 'append' ? [...prev, ...body.items] : body.items,
        );
        setCursor(body.nextCursor);
        setExhausted(body.nextCursor === null);
      } catch {
        setError('Exercises did not load. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    },
    [buildParams, cursor, loading],
  );

  // Re-fetch the first page whenever filters or submitted search change.
  // Using a key effect rather than useQuery to keep dependencies minimal.
  const filterKey = `${submittedSearch}|${category}|${equipment}`;
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
              <HapticPressable
                disableAnimation
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
              </HapticPressable>
            );
          })}
        </ScrollView>
      </View>
    ),
    [styles],
  );

  const renderItem = useCallback(
    ({ item }: { item: Exercise }) => (
      <HapticPressable
        disableAnimation
        onPress={() =>
          navigation.navigate('ExerciseDetail', { idOrSlug: item.id })
        }
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name}`}
      >
        <Text style={styles.rowName}>{item.name}</Text>
        <Text style={styles.rowMeta}>
          {[item.primaryMuscle, item.equipment.join(', '), item.category, item.difficulty]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </HapticPressable>
    ),
    [navigation, styles],
  );

  return (
    <View style={styles.screen} testID="exercise-library-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Exercise library</Text>
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
        {renderChipRow('Body part', BODY_PART_CHIPS, category, setCategory)}
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
          <HapticPressable disableAnimation style={styles.retry} accessibilityRole="button" onPress={() => void fetchPage('replace')}>
            <Text style={styles.retryText}>Retry</Text>
          </HapticPressable>
        </View>
      ) : null}

      <FlatList
        testID="exercise-library-list"
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
      ...typography.h1,
      color: sc.textPrimary,
      marginBottom: spacing.md,
    },
    searchInput: {
      ...typography.body,
      color: sc.textPrimary,
      minHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
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
      minHeight: 44,
      minWidth: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    chipActive: {
      borderBottomWidth: 2,
      borderBottomColor: sc.textPrimary,
    },
    chipText: {
      ...typography.bodySmall,
      color: sc.textMuted,
    },
    chipTextActive: {
      color: sc.textPrimary,
    },
    listContent: {
      paddingBottom: spacing.xl,
    },
    row: {
      minHeight: 44,
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
      color: sc.accentText,
    },
    retry: {
      minHeight: 44,
      minWidth: 120,
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: sc.accent,
    },
    retryText: {
      ...typography.bodyMd,
      color: sc.textOnAccent,
    },
    footerWrap: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
  });
}
