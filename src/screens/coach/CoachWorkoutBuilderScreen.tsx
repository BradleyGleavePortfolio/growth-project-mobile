/**
 * CoachWorkoutBuilderScreen — Phase 11 / Track 6.
 *
 * Allows a coach to:
 *   1. Set plan metadata (name, type, estimated duration).
 *   2. Search the exercise catalog and add exercises to the plan.
 *   3. Edit sets, reps/duration, and weight for each exercise row inline.
 *   4. Reorder exercises via up/down controls.
 *   5. Assign the finished plan to a single client and schedule a date.
 *
 * Architecture:
 *   - All ExerciseDB traffic goes through the backend (/exercises/search).
 *   - Search input is debounced 400ms to avoid hammering the endpoint.
 *   - Plan state is local until "Save Plan" is tapped, at which point a
 *     POST /workout-plans is issued followed by a PUT …/exercises call.
 *   - The assign panel appears after a plan is saved.
 *
 * Defer: client-side workout execution UI (sets timer, rest timer,
 * completion feedback) is out of scope for this track.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors as tokens, spacing, typography } from '../../theme/tokens';
import {
  searchExercises,
  type Exercise,
} from '../../services/exerciseLibraryApi';
import {
  createWorkoutPlan,
  setExerciseRows,
  assignWorkoutPlan,
  type WorkoutType,
  type ExerciseRowPayload,
  type WorkoutPlan,
} from '../../services/workoutBuilderApi';

// ─── Local types ─────────────────────────────────────────────────────────────

interface ExerciseRow {
  exercise: Exercise;
  order: number;
  sets: string;
  repsOrDuration: string;
  weightLbs: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKOUT_TYPES: WorkoutType[] = ['strength', 'cardio', 'mobility'];
const DEBOUNCE_MS = 400;

// ─── Component ────────────────────────────────────────────────────────────────

export default function CoachWorkoutBuilderScreen() {
  // Meta panel
  const [planName, setPlanName] = useState('');
  const [planType, setPlanType] = useState<WorkoutType>('strength');
  const [durationMinutes, setDurationMinutes] = useState('');

  // Exercise search drawer
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Exercise[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Plan exercise rows
  const [rows, setRows] = useState<ExerciseRow[]>([]);

  // Assign panel
  const [savedPlan, setSavedPlan] = useState<WorkoutPlan | null>(null);
  const [clientId, setClientId] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Debounced search ───────────────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      runSearch(searchQuery.trim());
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const runSearch = useCallback(async (q: string) => {
    setSearchLoading(true);
    try {
      const result = await searchExercises({ q, limit: 20 });
      setSearchResults(result.items);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // ─── Add exercise from search ───────────────────────────────────────────

  const addExercise = useCallback(
    (exercise: Exercise) => {
      if (rows.some((r) => r.exercise.id === exercise.id)) return;
      setRows((prev) => [
        ...prev,
        {
          exercise,
          order: prev.length + 1,
          sets: '3',
          repsOrDuration: '10',
          weightLbs: '',
        },
      ]);
      setDrawerOpen(false);
      setSearchQuery('');
      setSearchResults([]);
    },
    [rows],
  );

  // ─── Row field updates ──────────────────────────────────────────────────

  const updateRow = useCallback(
    (exerciseId: string, field: 'sets' | 'repsOrDuration' | 'weightLbs', value: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.exercise.id === exerciseId ? { ...r, [field]: value } : r,
        ),
      );
    },
    [],
  );

  const removeRow = useCallback((exerciseId: string) => {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.exercise.id !== exerciseId);
      return filtered.map((r, i) => ({ ...r, order: i + 1 }));
    });
  }, []);

  const moveRow = useCallback((exerciseId: string, direction: 'up' | 'down') => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.exercise.id === exerciseId);
      if (idx === -1) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === prev.length - 1) return prev;
      const next = [...prev];
      const swap = direction === 'up' ? idx - 1 : idx + 1;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next.map((r, i) => ({ ...r, order: i + 1 }));
    });
  }, []);

  // ─── Save plan ──────────────────────────────────────────────────────────

  const savePlan = useCallback(async () => {
    if (!planName.trim()) {
      Alert.alert('Plan name required', 'Please enter a name for the plan.');
      return;
    }
    if (rows.length === 0) {
      Alert.alert('No exercises', 'Add at least one exercise before saving.');
      return;
    }

    setSaveLoading(true);
    try {
      const plan = await createWorkoutPlan({
        name: planName.trim(),
        type: planType,
        ...(durationMinutes && {
          duration_estimate_minutes: parseInt(durationMinutes, 10),
        }),
      });

      const exercisePayload: ExerciseRowPayload[] = rows.map((r) => ({
        exercise_external_id: r.exercise.id,
        order: r.order,
        sets: parseInt(r.sets, 10) || 1,
        reps_or_duration_seconds: parseInt(r.repsOrDuration, 10) || 10,
        ...(r.weightLbs && { weight_lbs: parseFloat(r.weightLbs) }),
      }));

      await setExerciseRows(plan.id, exercisePayload);
      setSavedPlan(plan);
      Alert.alert('Plan saved', `"${plan.name}" has been saved.`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      Alert.alert('Save failed', message);
    } finally {
      setSaveLoading(false);
    }
  }, [planName, planType, durationMinutes, rows]);

  // ─── Assign plan ────────────────────────────────────────────────────────

  const assignPlan = useCallback(async () => {
    if (!savedPlan) return;
    if (!clientId.trim()) {
      Alert.alert('Client required', 'Enter a client ID to assign this plan.');
      return;
    }
    if (!scheduledFor.trim()) {
      Alert.alert('Date required', 'Enter a scheduled date (ISO format).');
      return;
    }

    setAssignLoading(true);
    try {
      await assignWorkoutPlan(savedPlan.id, {
        client_id: clientId.trim(),
        scheduled_for: scheduledFor.trim(),
      });
      Alert.alert('Assigned', 'Workout plan assigned to client.');
      setClientId('');
      setScheduledFor('');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to assign plan.';
      Alert.alert('Assignment failed', message);
    } finally {
      setAssignLoading(false);
    }
  }, [savedPlan, clientId, scheduledFor]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Header ── */}
        <Text style={styles.heading} accessibilityRole="header">
          Workout Builder
        </Text>

        {/* ── Meta panel ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Plan name</Text>
          <TextInput
            style={styles.input}
            value={planName}
            onChangeText={setPlanName}
            placeholder="e.g. Push Day A"
            placeholderTextColor={tokens.stone}
            accessibilityLabel="Plan name input"
            accessibilityRole="none"
            maxLength={120}
            testID="plan-name-input"
          />

          <Text style={styles.sectionLabel}>Type</Text>
          <View style={styles.typeRow}>
            {WORKOUT_TYPES.map((t) => (
              <Pressable
                key={t}
                style={[styles.typeChip, planType === t && styles.typeChipActive]}
                onPress={() => setPlanType(t)}
                accessibilityLabel={`Workout type ${t}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: planType === t }}
              >
                <Text
                  style={[styles.typeChipText, planType === t && styles.typeChipTextActive]}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Estimated duration (minutes)</Text>
          <TextInput
            style={styles.input}
            value={durationMinutes}
            onChangeText={setDurationMinutes}
            placeholder="45"
            placeholderTextColor={tokens.stone}
            keyboardType="number-pad"
            accessibilityLabel="Estimated duration in minutes"
            accessibilityRole="none"
            maxLength={4}
          />
        </View>

        {/* ── Exercise rows ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Exercises</Text>
            <Pressable
              style={styles.addExerciseBtn}
              onPress={() => setDrawerOpen(true)}
              accessibilityLabel="Open exercise search"
              accessibilityRole="button"
            >
              <Text style={styles.addExerciseBtnText}>+ Add</Text>
            </Pressable>
          </View>

          {rows.length === 0 && (
            <Text style={styles.emptyHint}>
              No exercises added yet. Tap "+ Add" to search the catalog.
            </Text>
          )}

          {rows.map((row, idx) => (
            <View key={row.exercise.id} style={styles.exerciseRow}>
              <View style={styles.exerciseRowHeader}>
                <Text style={styles.exerciseName} numberOfLines={1}>
                  {idx + 1}. {row.exercise.name}
                </Text>
                <View style={styles.exerciseRowActions}>
                  <Pressable
                    onPress={() => moveRow(row.exercise.id, 'up')}
                    accessibilityLabel={`Move ${row.exercise.name} up`}
                    accessibilityRole="button"
                    style={styles.moveBtn}
                  >
                    <Text style={styles.moveBtnText}>Up</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => moveRow(row.exercise.id, 'down')}
                    accessibilityLabel={`Move ${row.exercise.name} down`}
                    accessibilityRole="button"
                    style={styles.moveBtn}
                  >
                    <Text style={styles.moveBtnText}>Dn</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => removeRow(row.exercise.id)}
                    accessibilityLabel={`Remove ${row.exercise.name}`}
                    accessibilityRole="button"
                    style={styles.removeBtn}
                  >
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={styles.exerciseMeta}>
                {row.exercise.bodyPart} · {row.exercise.equipment}
              </Text>
              <View style={styles.exerciseFields}>
                <View style={styles.exerciseField}>
                  <Text style={styles.fieldLabel}>Sets</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={row.sets}
                    onChangeText={(v) => updateRow(row.exercise.id, 'sets', v)}
                    keyboardType="number-pad"
                    accessibilityLabel={`Sets for ${row.exercise.name}`}
                    accessibilityRole="none"
                    maxLength={3}
                  />
                </View>
                <View style={styles.exerciseField}>
                  <Text style={styles.fieldLabel}>Reps / sec</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={row.repsOrDuration}
                    onChangeText={(v) =>
                      updateRow(row.exercise.id, 'repsOrDuration', v)
                    }
                    keyboardType="number-pad"
                    accessibilityLabel={`Reps or duration for ${row.exercise.name}`}
                    accessibilityRole="none"
                    maxLength={4}
                  />
                </View>
                <View style={styles.exerciseField}>
                  <Text style={styles.fieldLabel}>Weight (lbs)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={row.weightLbs}
                    onChangeText={(v) => updateRow(row.exercise.id, 'weightLbs', v)}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    placeholderTextColor={tokens.stone}
                    accessibilityLabel={`Weight in pounds for ${row.exercise.name}`}
                    accessibilityRole="none"
                    maxLength={6}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* ── Save button ── */}
        <Pressable
          style={[styles.primaryBtn, saveLoading && styles.primaryBtnDisabled]}
          onPress={savePlan}
          disabled={saveLoading}
          accessibilityLabel="Save workout plan"
          accessibilityRole="button"
          accessibilityState={{ disabled: saveLoading }}
          testID="save-plan-button"
        >
          {saveLoading ? (
            <ActivityIndicator color={tokens.bone} />
          ) : (
            <Text style={styles.primaryBtnText}>Save Plan</Text>
          )}
        </Pressable>

        {/* ── Assign panel — visible after save ── */}
        {savedPlan && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Assign Plan</Text>
            <Text style={styles.sectionLabel}>Client ID</Text>
            <TextInput
              style={styles.input}
              value={clientId}
              onChangeText={setClientId}
              placeholder="Client user UUID"
              placeholderTextColor={tokens.stone}
              accessibilityLabel="Client ID input"
              accessibilityRole="none"
              autoCapitalize="none"
            />
            <Text style={styles.sectionLabel}>Scheduled for (ISO date)</Text>
            <TextInput
              style={styles.input}
              value={scheduledFor}
              onChangeText={setScheduledFor}
              placeholder="2025-06-01T09:00:00Z"
              placeholderTextColor={tokens.stone}
              accessibilityLabel="Scheduled date input"
              accessibilityRole="none"
              autoCapitalize="none"
            />
            <Pressable
              style={[styles.primaryBtn, assignLoading && styles.primaryBtnDisabled]}
              onPress={assignPlan}
              disabled={assignLoading}
              accessibilityLabel="Assign plan to client"
              accessibilityRole="button"
              accessibilityState={{ disabled: assignLoading }}
            >
              {assignLoading ? (
                <ActivityIndicator color={tokens.bone} />
              ) : (
                <Text style={styles.primaryBtnText}>Assign to Client</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* ── Exercise search drawer ── */}
      {drawerOpen && (
        <View style={styles.drawer}>
          <View style={styles.drawerHeader}>
            <Text style={styles.drawerTitle}>Search Exercises</Text>
            <Pressable
              onPress={() => {
                setDrawerOpen(false);
                setSearchQuery('');
                setSearchResults([]);
              }}
              accessibilityLabel="Close exercise search"
              accessibilityRole="button"
              style={styles.drawerClose}
            >
              <Text style={styles.drawerCloseText}>Close</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name or muscle group…"
            placeholderTextColor={tokens.stone}
            accessibilityLabel="Exercise search input"
            accessibilityRole="search"
            autoFocus
            testID="exercise-search-input"
          />
          {searchLoading && (
            <ActivityIndicator style={styles.searchSpinner} color={tokens.forest} />
          )}
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            style={styles.searchList}
            renderItem={({ item }) => (
              <Pressable
                style={styles.searchResultItem}
                onPress={() => addExercise(item)}
                accessibilityLabel={`Add exercise ${item.name}`}
                accessibilityRole="button"
              >
                <Text style={styles.searchResultName}>{item.name}</Text>
                <Text style={styles.searchResultMeta}>
                  {item.bodyPart} · {item.equipment}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              !searchLoading && searchQuery.length > 0 ? (
                <Text style={styles.emptyHint}>No exercises found.</Text>
              ) : null
            }
            keyboardShouldPersistTaps="handled"
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bone,
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  heading: {
    ...typography.h2,
    color: tokens.ink,
    marginBottom: spacing.md,
  },
  section: {
    backgroundColor: tokens.cream,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.h4,
    color: tokens.ink,
  },
  sectionLabel: {
    ...typography.caption,
    color: tokens.charcoal,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.stone,
    borderRadius: 8,
    padding: spacing.sm,
    color: tokens.ink,
    backgroundColor: tokens.bone,
    ...typography.body,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: tokens.stone,
    backgroundColor: tokens.bone,
  },
  typeChipActive: {
    borderColor: tokens.forest,
    backgroundColor: tokens.forest,
  },
  typeChipText: {
    ...typography.caption,
    color: tokens.charcoal,
  },
  typeChipTextActive: {
    color: tokens.bone,
  },
  emptyHint: {
    ...typography.caption,
    color: tokens.stone,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  exerciseRow: {
    borderTopWidth: 1,
    borderTopColor: tokens.stone,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  exerciseRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exerciseName: {
    ...typography.body,
    color: tokens.ink,
    flex: 1,
    fontWeight: '600',
  },
  exerciseRowActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  moveBtn: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: tokens.stone,
    borderRadius: 4,
  },
  moveBtnText: {
    ...typography.caption,
    color: tokens.charcoal,
    fontSize: 10,
  },
  removeBtn: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: tokens.error,
    borderRadius: 4,
  },
  removeBtnText: {
    ...typography.caption,
    color: tokens.error,
    fontSize: 10,
  },
  exerciseMeta: {
    ...typography.caption,
    color: tokens.stone,
    marginTop: 2,
  },
  exerciseFields: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  exerciseField: {
    flex: 1,
  },
  fieldLabel: {
    ...typography.caption,
    color: tokens.charcoal,
    marginBottom: 2,
    fontSize: 10,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: tokens.stone,
    borderRadius: 6,
    padding: spacing.xs,
    color: tokens.ink,
    backgroundColor: tokens.bone,
    textAlign: 'center',
    ...typography.body,
  },
  primaryBtn: {
    backgroundColor: tokens.forest,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    ...typography.h4,
    color: tokens.bone,
  },
  addExerciseBtn: {
    backgroundColor: tokens.forest,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  addExerciseBtnText: {
    ...typography.caption,
    color: tokens.bone,
    fontWeight: '700',
  },
  // ── Drawer ──
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
    backgroundColor: tokens.cream,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: tokens.ink,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    padding: spacing.md,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  drawerTitle: {
    ...typography.h4,
    color: tokens.ink,
  },
  drawerClose: {
    padding: spacing.xs,
  },
  drawerCloseText: {
    ...typography.caption,
    color: tokens.forest,
    fontWeight: '700',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: tokens.stone,
    borderRadius: 8,
    padding: spacing.sm,
    color: tokens.ink,
    backgroundColor: tokens.bone,
    ...typography.body,
    marginBottom: spacing.sm,
  },
  searchSpinner: {
    marginVertical: spacing.sm,
  },
  searchList: {
    flex: 1,
  },
  searchResultItem: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.stone,
  },
  searchResultName: {
    ...typography.body,
    color: tokens.ink,
    textTransform: 'capitalize',
  },
  searchResultMeta: {
    ...typography.caption,
    color: tokens.stone,
    marginTop: 2,
  },
});
