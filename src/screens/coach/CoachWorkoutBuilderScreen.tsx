/**
 * CoachWorkoutBuilderScreen — create or edit a coach-owned workout
 * plan and (optionally) seed its ordered exercise rows.
 *
 * Sprint B-2 final wave. The screen wraps three workout-builder hooks:
 *   - useCreateWorkoutPlan      (when params.planId is undefined)
 *   - useUpdateWorkoutPlan      (when editing an existing plan)
 *   - useSetWorkoutExercises    (replace-all semantics, matches the
 *                                PUT /workout-plans/:id/exercises
 *                                contract on the backend)
 *
 * Exercise rows are populated by searching the ExerciseDB-backed
 * catalog via useExerciseSearch. Reorder is intentionally simple —
 * up/down arrow buttons on each row instead of pulling in a
 * drag-and-drop dependency. Sets, reps_or_duration_seconds, rest, and
 * notes are inline numeric inputs.
 *
 * Palette note: uses `sc.accent` from useTheme(). On Body pillar this
 * resolves to forest (#2C4A36). Oxblood (#4A0404) is reserved for the
 * Finance pillar per src/theme/tokens.ts line 48. PR #130's coach
 * screens follow the same convention; we mirror it here.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Exercise } from '../../api/exerciseLibraryApi';
import type {
  UpsertExerciseRowInput,
  WorkoutType,
} from '../../api/workoutBuilderApi';
import {
  useCreateWorkoutPlan,
  useSetWorkoutExercises,
  useUpdateWorkoutPlan,
  useWorkoutPlan,
} from '../../hooks/useWorkoutBuilder';
import { useExerciseSearch } from '../../hooks/useExerciseLibrary';
import { spacing, typography } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

type RouteParam = { planId?: string };

const WORKOUT_TYPES: WorkoutType[] = ['strength', 'cardio', 'mobility'];

interface DraftExerciseRow {
  exercise_external_id: string;
  display_name: string;
  sets: number;
  reps_or_duration_seconds: number;
  rest_seconds: number | null;
  notes: string | null;
}

export default function CoachWorkoutBuilderScreen() {
  const route = useRoute<RouteProp<Record<string, RouteParam>, string>>();
  const navigation = useNavigation();
  const planId = route.params?.planId;
  const isEditing = Boolean(planId);

  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const {
    data: existingPlan,
    isLoading: isPlanLoading,
    isError: isPlanError,
    error: planError,
    refetch: refetchPlan,
  } = useWorkoutPlan(planId);
  // In edit mode, hydration completes only after the async plan query resolves.
  // Until then, save MUST be blocked or we can wipe the plan's exercise rows.
  // (Finding 1 in the GPT-5.5 audit, 2026-05-20.)
  const isHydrating = isEditing && (isPlanLoading || !existingPlan);
  const createMut = useCreateWorkoutPlan();
  const updateMut = useUpdateWorkoutPlan();
  const setExercisesMut = useSetWorkoutExercises();

  const [name, setName] = useState<string>(existingPlan?.name ?? '');
  const [type, setType] = useState<WorkoutType>(
    existingPlan?.type ?? 'strength',
  );
  const [duration, setDuration] = useState<string>(
    existingPlan?.duration_estimate_minutes != null
      ? String(existingPlan.duration_estimate_minutes)
      : '',
  );
  const [rows, setRows] = useState<DraftExerciseRow[]>(
    (existingPlan?.exercises ?? []).map((e) => ({
      exercise_external_id: e.exercise_external_id,
      display_name: e.exercise_external_id,
      sets: e.sets,
      reps_or_duration_seconds: e.reps_or_duration_seconds,
      rest_seconds: e.rest_seconds,
      notes: e.notes,
    })),
  );

  // ── FIX 2: Hydrate local draft state when the async plan query resolves ───
  // Guard with a ref so in-progress dirty edits are never clobbered by a
  // background refetch — only the first successful load for this planId seeds
  // the form.
  const hydratedPlanIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!existingPlan || hydratedPlanIdRef.current === existingPlan.id) return;
    hydratedPlanIdRef.current = existingPlan.id;
    setName(existingPlan.name ?? '');
    setType(existingPlan.type ?? 'strength');
    setDuration(
      existingPlan.duration_estimate_minutes != null
        ? String(existingPlan.duration_estimate_minutes)
        : '',
    );
    // Defensively sort by `order` — other consumers in the codebase already do
    // this (see buildActiveWorkout.ts, WorkoutAssignmentDetailScreen.tsx). If
    // we trusted API order and the backend returned rows out-of-order even
    // once, edit/save would silently renumber them. (Finding 2.)
    const sortedExercises = [...(existingPlan.exercises ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    setRows(
      sortedExercises.map((e) => ({
        exercise_external_id: e.exercise_external_id,
        display_name: e.exercise_external_id,
        sets: e.sets,
        reps_or_duration_seconds: e.reps_or_duration_seconds,
        rest_seconds: e.rest_seconds,
        notes: e.notes,
      })),
    );
  }, [existingPlan]);

  // Search box state — local-only.
  const [search, setSearch] = useState<string>('');
  const searchEnabled = search.trim().length >= 2;
  const { data: searchResult } = useExerciseSearch(
    { q: search.trim(), limit: 8 },
    { enabled: searchEnabled },
  );

  const addExercise = useCallback((ex: Exercise) => {
    setRows((cur) => [
      ...cur,
      {
        exercise_external_id: ex.id,
        display_name: ex.name,
        sets: 3,
        reps_or_duration_seconds: 10,
        rest_seconds: 60,
        notes: null,
      },
    ]);
    setSearch('');
  }, []);

  const moveRow = useCallback((idx: number, dir: -1 | 1) => {
    setRows((cur) => {
      const next = cur.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return cur;
      const tmp = next[idx] as DraftExerciseRow;
      next[idx] = next[target] as DraftExerciseRow;
      next[target] = tmp;
      return next;
    });
  }, []);

  const removeRow = useCallback((idx: number) => {
    setRows((cur) => cur.filter((_, i) => i !== idx));
  }, []);

  const updateRow = useCallback(
    (idx: number, patch: Partial<DraftExerciseRow>) => {
      setRows((cur) =>
        cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  // ── FIX 3: reject zero/negative/non-finite for sets and reps fields ───────
  // rest_seconds is allowed to be 0 (no-rest exercises are valid). Use
  // Number.isFinite to also catch NaN, which can sneak in if the input parser
  // upstream ever changes. (Finding 3 partial / Finding 4 robustness.)
  const isInvalidPositiveInt = (n: number) => !Number.isFinite(n) || n < 1;
  const rowsHaveInvalidNumeric = rows.some(
    (r) =>
      isInvalidPositiveInt(r.sets) ||
      isInvalidPositiveInt(r.reps_or_duration_seconds),
  );

  const canSave =
    name.trim().length > 0 &&
    !rowsHaveInvalidNumeric &&
    !isHydrating &&
    !createMut.isPending &&
    !updateMut.isPending &&
    !setExercisesMut.isPending;

  const onSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    // Guard: never save while edit-mode hydration is still pending. Without
    // this, a coach could enter a name and hit save before the existing
    // plan's exercises have loaded, then setExercises([]) would wipe them.
    // (Finding 1 — HIGH severity data-loss bug.)
    if (isEditing && !existingPlan) {
      Alert.alert(
        'Still loading',
        'Wait for the plan to finish loading before saving.',
      );
      return;
    }
    // Secondary guard: reject if any row still has invalid numeric values.
    // Pinpoint the specific invalid field so coaches know what to fix.
    // (Finding 4 — copy accuracy for negative values.)
    const invalidRow = rows.find(
      (r) =>
        isInvalidPositiveInt(r.sets) ||
        isInvalidPositiveInt(r.reps_or_duration_seconds),
    );
    if (invalidRow) {
      const badField = isInvalidPositiveInt(invalidRow.sets) ? 'sets' : 'reps/duration';
      Alert.alert(
        'Invalid exercise values',
        `"${invalidRow.display_name}" has an invalid ${badField} value. Sets and reps/duration must be at least 1.`,
      );
      return;
    }
    const durationParsed = duration.trim() ? parseInt(duration.trim(), 10) : undefined;
    const cleanDuration =
      typeof durationParsed === 'number' &&
      Number.isFinite(durationParsed) &&
      durationParsed > 0
        ? durationParsed
        : undefined;

    try {
      let resolvedPlanId = planId;
      if (isEditing && planId) {
        await updateMut.mutateAsync({
          planId,
          input: {
            name: trimmedName,
            type,
            duration_estimate_minutes: cleanDuration,
          },
        });
      } else {
        const created = await createMut.mutateAsync({
          name: trimmedName,
          type,
          duration_estimate_minutes: cleanDuration,
        });
        resolvedPlanId = created.id;
      }

      if (resolvedPlanId) {
        const payload: UpsertExerciseRowInput[] = rows.map((r, idx) => ({
          exercise_external_id: r.exercise_external_id,
          order: idx + 1,
          sets: r.sets,
          reps_or_duration_seconds: r.reps_or_duration_seconds,
          rest_seconds: r.rest_seconds ?? undefined,
          notes: r.notes ?? undefined,
        }));
        await setExercisesMut.mutateAsync({
          planId: resolvedPlanId,
          rows: payload,
        });
      }
      Alert.alert('Plan saved', 'Workout plan saved successfully.');
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        'Could not save plan',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  }, [
    createMut,
    duration,
    existingPlan,
    isEditing,
    name,
    navigation,
    planId,
    rows,
    setExercisesMut,
    type,
    updateMut,
  ]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[typography.h2, { color: sc.textPrimary }]}>
          {isEditing ? 'Edit workout plan' : 'New workout plan'}
        </Text>

        {/* Edit-mode hydration banner — Finding 1 fix UX. Shows the coach that
            the plan is loading so they know not to bash Save. Banner disappears
            as soon as existingPlan resolves and the form hydrates. */}
        {isEditing && isPlanLoading ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.statusBanner, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}
          >
            <Text style={[typography.body, { color: sc.textPrimary }]}>
              Loading plan…
            </Text>
            <Text style={[typography.caption, { color: sc.textMuted, marginTop: 2 }]}>
              Editing is disabled until the plan finishes loading so we don’t overwrite your exercises.
            </Text>
          </View>
        ) : null}

        {/* Error banner with retry. If the plan fetch fails, save MUST remain
            blocked or we’d overwrite with empty state.

            Uses semantic danger tokens (sc.danger/dangerBg/dangerBorder/dangerAction)
            which are AA-compliant in both light and dark mode — verified ≥7:1 contrast
            against bgSurface in each mode. Avoids the previous hard-coded #C0392B which
            only met contrast on light backgrounds. */}
        {isEditing && isPlanError ? (
          <View
            accessibilityLiveRegion="assertive"
            style={[
              styles.statusBanner,
              { borderColor: sc.dangerBorder, backgroundColor: sc.dangerBg },
            ]}
          >
            <Text style={[typography.body, { color: sc.danger }]}>
              Could not load this plan.
            </Text>
            <Text style={[typography.caption, { color: sc.textPrimary, marginTop: 2 }]}>
              {planError instanceof Error ? planError.message : 'Unknown error.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading plan"
              onPress={() => {
                void refetchPlan();
              }}
              style={[styles.retryBtn, { borderColor: sc.dangerAction }]}
            >
              <Text style={[typography.body, { color: sc.dangerAction }]}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Plan name
        </Text>
        <TextInput
          accessibilityLabel="Plan name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Push day A"
          placeholderTextColor={sc.textMuted}
          style={styles.input}
          maxLength={120}
        />

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Type
        </Text>
        <View style={styles.typeRow}>
          {WORKOUT_TYPES.map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              onPress={() => setType(t)}
              style={[
                styles.typeChip,
                { borderColor: sc.textMuted },
                type === t && { backgroundColor: sc.accent, borderColor: sc.accent },
              ]}
            >
              <Text
                style={[
                  typography.body,
                  { color: type === t ? sc.bgPrimary : sc.textPrimary },
                ]}
              >
                {t}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Estimated duration (minutes, optional)
        </Text>
        <TextInput
          accessibilityLabel="Estimated duration in minutes"
          value={duration}
          onChangeText={setDuration}
          keyboardType="number-pad"
          placeholder="45"
          placeholderTextColor={sc.textMuted}
          style={styles.input}
          maxLength={4}
        />

        <Text style={[typography.h3, styles.sectionHeading, { color: sc.textPrimary }]}>
          Exercises
        </Text>

        {rows.length === 0 ? (
          <Text style={[typography.body, { color: sc.textMuted }]}>
            No exercises yet. Search below to add some.
          </Text>
        ) : (
          rows.map((row, idx) => (
            <View
              key={`${row.exercise_external_id}-${idx}`}
              style={[styles.rowCard, { borderColor: sc.border }]}
            >
              <View style={styles.rowHeader}>
                <Text style={[typography.body, { color: sc.textPrimary }]}>
                  {idx + 1}. {row.display_name}
                </Text>
                <View style={styles.rowControls}>
                  <Pressable
                    accessibilityLabel="Move exercise up"
                    onPress={() => moveRow(idx, -1)}
                    disabled={idx === 0}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textPrimary }]}>
                      Up
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Move exercise down"
                    onPress={() => moveRow(idx, 1)}
                    disabled={idx === rows.length - 1}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textPrimary }]}>
                      Down
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Remove exercise"
                    onPress={() => removeRow(idx)}
                    style={styles.controlBtn}
                  >
                    <Text style={[typography.body, { color: sc.textMuted }]}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.rowInputs}>
                <NumberField
                  label="Sets"
                  value={row.sets}
                  onChange={(v) => updateRow(idx, { sets: v })}
                  sc={sc}
                  minValue={1}
                />
                <NumberField
                  label="Reps / sec"
                  value={row.reps_or_duration_seconds}
                  onChange={(v) => updateRow(idx, { reps_or_duration_seconds: v })}
                  sc={sc}
                  minValue={1}
                />
                <NumberField
                  label="Rest (s)"
                  value={row.rest_seconds ?? 0}
                  onChange={(v) => updateRow(idx, { rest_seconds: v })}
                  sc={sc}
                />
              </View>
            </View>
          ))
        )}

        <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
          Add exercise (search)
        </Text>
        <TextInput
          accessibilityLabel="Search exercise catalog"
          value={search}
          onChangeText={setSearch}
          placeholder="bench press, squat, ..."
          placeholderTextColor={sc.textMuted}
          style={styles.input}
        />
        {searchEnabled && searchResult?.items?.length ? (
          <View style={styles.searchResults}>
            {searchResult.items.map((ex) => (
              <Pressable
                key={ex.id}
                accessibilityRole="button"
                onPress={() => addExercise(ex)}
                style={[styles.searchHit, { borderColor: sc.border }]}
              >
                <Text style={[typography.body, { color: sc.textPrimary }]}>
                  {ex.name}
                </Text>
                {ex.bodyPart ? (
                  <Text style={[typography.caption, { color: sc.textMuted }]}>
                    {ex.bodyPart}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isEditing ? 'Save changes' : 'Create plan'}
          disabled={!canSave}
          onPress={() => {
            void onSave();
          }}
          style={[
            styles.saveBtn,
            { backgroundColor: canSave ? sc.accent : sc.border },
          ]}
        >
          <Text style={[typography.h4, { color: sc.bgPrimary }]}>
            {createMut.isPending || updateMut.isPending || setExercisesMut.isPending
              ? 'Saving...'
              : isHydrating
                ? 'Loading plan…'
                : isEditing
                  ? 'Save changes'
                  : 'Create plan'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  sc: SemanticTokens;
  /** When set, values strictly below minValue show an inline validation error
   *  and a red border. Pass minValue={1} for sets/reps; omit for rest. */
  minValue?: number;
}) {
  const { label, value, onChange, sc, minValue } = props;
  const isInvalid = minValue !== undefined && value < minValue;
  return (
    <View style={{ flex: 1 }}>
      <Text style={[typography.caption, { color: sc.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={String(value)}
        onChangeText={(t) => {
          const parsed = parseInt(t.replace(/[^0-9]/g, ''), 10);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        keyboardType="number-pad"
        style={{
          borderWidth: 1,
          borderColor: isInvalid ? sc.danger : sc.border,
          borderRadius: 6,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          color: sc.textPrimary,
          marginRight: spacing.xs,
        }}
        maxLength={4}
      />
      {isInvalid ? (
        <Text
          accessibilityRole="alert"
          style={[typography.caption, { color: sc.danger, marginTop: 2 }]}
        >
          {`Must be ≥ ${minValue}`}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, paddingBottom: spacing["2xl"] },
    label: { marginTop: spacing.md, marginBottom: spacing.xs },
    input: {
      borderWidth: 1,
      borderColor: sc.border,
      borderRadius: 8,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: sc.textPrimary,
    },
    typeRow: { flexDirection: 'row', gap: spacing.sm },
    typeChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    sectionHeading: { marginTop: spacing.xl, marginBottom: spacing.sm },
    rowCard: {
      borderWidth: 1,
      borderRadius: 10,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    rowHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    rowControls: { flexDirection: 'row', gap: spacing.sm },
    controlBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    rowInputs: { flexDirection: 'row', gap: spacing.sm },
    searchResults: { marginTop: spacing.sm },
    searchHit: {
      borderWidth: 1,
      borderRadius: 8,
      padding: spacing.sm,
      marginBottom: spacing.xs,
    },
    saveBtn: {
      marginTop: spacing.xl,
      borderRadius: 12,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    statusBanner: {
      borderWidth: 1,
      borderRadius: 8,
      padding: spacing.md,
      marginTop: spacing.md,
    },
    retryBtn: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      marginTop: spacing.sm,
      alignSelf: 'flex-start',
    },
  });
}
