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
import { Ionicons } from '@expo/vector-icons';
import { exerciseCatalogApi } from '../../api/exerciseCatalog';
import type {
  Exercise,
  ExerciseListParams,
  ExerciseListResponse,
} from '../../types/exerciseCatalog';
import { layout, radius, spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import HapticPressable from '../../components/HapticPressable';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';
import { MastheadBand, mast, wsc } from './workouts/workoutStyleC';

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
                style={styles.chip}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.pill, active && styles.pillActive]}>
                  <Text
                    style={[
                      styles.chipText,
                      active && styles.chipTextActive,
                    ]}
                  >
                    {v}
                  </Text>
                </View>
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
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{item.name}</Text>
          <Text style={styles.rowMeta}>
            {[item.primaryMuscle, item.equipment.join(', '), item.category, item.difficulty]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={sc.textPrimary} accessibilityElementsHidden importantForAccessibility="no" />
      </HapticPressable>
    ),
    [navigation, styles, sc],
  );

  return (
    <View style={styles.screen} testID="exercise-library-screen">
      <MastheadBand color={mast.ground} />
      <View style={styles.header}>
        <Text style={styles.title}>Exercise library</Text>
        <View style={styles.searchField}>
          <Ionicons name="search" size={20} color={mast.muted} accessibilityElementsHidden importantForAccessibility="no" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search exercises"
            placeholderTextColor={mast.muted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={onSubmitSearch}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search exercises"
          />
        </View>
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
    // C1 v2 masthead (nearest picked drawing K3 C_picker, rows 0-433): deep forest, 24 pt bottom corners, 24 pt
    // gutter. The route's bar above takes the same ground (ClientNavigator) and MastheadBand paints the status bar.
    header: {
      backgroundColor: mast.ground,
      borderBottomLeftRadius: radius.sheet,
      borderBottomRightRadius: radius.sheet,
      paddingHorizontal: layout.gutter,
      paddingTop: spacing.sm,
      // rows 392-433: 20 pt under the pill, 6 of them inside its 44 pt target.
      paddingBottom: 14,
    },
    title: {
      ...typography.h1,
      color: mast.ink,
      marginBottom: spacing.md,
    },
    // C_picker rows 204-295: forest field, 1 pt frame line, 12 pt corners, the search glyph at cols 84-112.
    searchField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: wsc.searchHeight,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: mast.line,
      backgroundColor: mast.field,
      marginBottom: spacing.xs,
    },
    searchInput: {
      ...typography.body,
      flex: 1,
      color: mast.ink,
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    chipRow: {
      marginTop: spacing.sm,
    },
    chipRowLabel: {
      ...typography.eyebrow,
      color: mast.muted,
    },
    chipScrollContent: {
      gap: spacing.sm,
    },
    // A 44 pt target holding C_picker's 32 pt pill (rows 331-392).
    chip: {
      minHeight: layout.touchMin,
      minWidth: layout.touchMin,
      justifyContent: 'center',
    },
    pill: {
      minHeight: wsc.pillHeight,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      borderRadius: radius.chip,
      borderWidth: 1,
      borderColor: mast.line,
    },
    // The chosen chip is filled leaf with deep text (C_picker rows 332-391).
    pillActive: {
      backgroundColor: mast.chosen,
      borderColor: mast.chosen,
    },
    chipText: {
      ...typography.bodySmall,
      color: mast.ink,
    },
    chipTextActive: {
      color: mast.ground,
    },
    listContent: {
      paddingBottom: spacing.xl,
    },
    // C_picker rows 766-879: 56 pt rows from col 48, name over meta, hairline; C2_swap's chevron at cols 715-726.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: layout.rowMinHeight,
      paddingHorizontal: layout.gutter,
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    rowText: {
      flex: 1,
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
      borderRadius: radius.button,
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
