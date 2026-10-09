import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  FlatList,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';

import { getAllExercises } from '../../db/workoutDb';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { typography, radius } from '../../theme/tokens';
import { Screen } from '../../ui';
import HapticPressable from '../../components/HapticPressable';
import { errorMessage } from '../../types/common';
import { toServerMuscleGroup } from '../../utils/workout/muscleGroup';
import {
  buildRoutinePayload,
  routineToBuilderExercises,
  type RoutineBuilderExercise,
} from '../../utils/workout/workoutLogging';
import {
  useRoutines,
  useCreateRoutine,
  useUpdateRoutine,
  useDeleteRoutine,
} from '../../hooks/useApi';

type RoutineExercise = RoutineBuilderExercise;

interface Exercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
}

type RouteParams = {
  RoutineBuilder: { routineId?: string };
};

const MUSCLES = ['All', 'chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'core', 'full body', 'cardio'];

export default function RoutineBuilderScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<RouteProp<RouteParams, 'RoutineBuilder'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const routineId = route.params?.routineId;

  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<RoutineExercise[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [filteredExercises, setFilteredExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState('All');
  const [pickerStatus, setPickerStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const setInputs = useRef<Array<TextInput | null>>([]);
  const rowBounds = useRef<Array<{ y: number; height: number }>>([]);

  // Load existing routine via React Query so the cache is shared with the
  // routines list elsewhere in the app. When the screen is opened in "new"
  // mode (no routineId) the query simply isn't needed for hydration.
  const routinesQ = useRoutines();
  const createRoutine = useCreateRoutine();
  const updateRoutine = useUpdateRoutine();
  const deleteRoutine = useDeleteRoutine();
  const isSaving = createRoutine.isPending || updateRoutine.isPending;

  useEffect(() => {
    if (!routineId || !routinesQ.data) return;
    const routine = routinesQ.data.find((r) => r.id === routineId);
    if (!routine) return;
    setName(routine.name);
    // GET /routines returns RoutineExercise rows (default_sets /
    // default_reps / default_rest_seconds / muscle_group).
    const exs = routineToBuilderExercises(routine as unknown as Parameters<typeof routineToBuilderExercises>[0]);
    setExercises(exs);
  }, [routineId, routinesQ.data]);

  const openAddExercise = async () => {
    setShowAddModal(true);
    setSearchQuery('');
    setSelectedMuscle('All');
    setPickerStatus('loading');
    setFilteredExercises([]);
    try {
      const all = await getAllExercises();
      setAllExercises(all);
      setFilteredExercises(all);
      setPickerStatus('ready');
    } catch {
      setPickerStatus('error');
    }
  };

  const filterExercises = (query: string, muscle: string) => {
    let results = allExercises;
    if (muscle !== 'All') results = results.filter((e) => e.muscle === muscle);
    if (query.length >= 2) {
      const q = query.toLowerCase();
      results = results.filter((e) => e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q));
    }
    setFilteredExercises(results);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    filterExercises(query, selectedMuscle);
  };

  const handleMuscleFilter = (muscle: string) => {
    setSelectedMuscle(muscle);
    filterExercises(searchQuery, muscle);
  };

  const addExercise = (exercise: Exercise) => {
    setExercises((prev) => [
      ...prev,
      {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        sets: 3,
        reps: 10,
        restSec: 60,
        muscleGroup: toServerMuscleGroup(exercise.muscle),
      },
    ]);
    setShowAddModal(false);
  };

  const removeExercise = (idx: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateExerciseField = <K extends keyof RoutineExercise>(idx: number, field: K, value: RoutineExercise[K]) => {
    setExercises((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const moveExercise = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === exercises.length - 1) return;
    setExercises((prev) => {
      const updated = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [updated[idx], updated[swapIdx]] = [updated[swapIdx], updated[idx]];
      return updated;
    });
  };

  const dragExercise = (idx: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderRelease: (_event, gesture) => {
      const row = rowBounds.current[idx];
      if (!row) return;
      const center = row.y + row.height / 2 + gesture.dy;
      const next = rowBounds.current.findIndex((bounds) => center < bounds.y + bounds.height);
      const target = next === -1 ? exercises.length - 1 : next;
      setExercises((prev) => {
        const reordered = [...prev];
        const [moved] = reordered.splice(idx, 1);
        reordered.splice(target, 0, moved);
        return reordered;
      });
    },
  }).panHandlers;

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Routine name needed', 'Give your routine a name.');
      return;
    }
    if (exercises.length === 0) {
      Alert.alert('Exercise needed', 'Add at least one exercise.');
      return;
    }
    const payload = buildRoutinePayload(name, exercises);
    const onSuccess = () => navigation.goBack();
    const onError = (err: unknown) => {
      Alert.alert("Couldn't save routine", errorMessage(err, 'Check your connection and save the routine again.'));
    };
    if (routineId) {
      updateRoutine.mutate({ id: routineId, data: payload }, { onSuccess, onError });
    } else {
      createRoutine.mutate(payload, { onSuccess, onError });
    }
  };

  const handleDelete = () => {
    if (!routineId) return;
    Alert.alert('Delete routine?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRoutine.mutate(routineId, {
            onSuccess: () => navigation.goBack(),
            onError: (err) => {
              Alert.alert("Couldn't delete routine", errorMessage(err, 'Check your connection and delete the routine again.'));
            },
          });
        },
      },
    ]);
  };

  return (
    <Screen
      edges={['top']}
      contentStyle={styles.content}
      header={<View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Cancel routine" onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{routineId ? 'Edit routine' : 'New routine'}</Text>
        {routineId ? (
          <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Delete routine" onPress={handleDelete}>
            <Ionicons name="trash-outline" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconButton} />
        )}
      </View>}
      footer={
        <HapticPressable style={styles.saveBtn} disableAnimation accessibilityLabel="Save routine" accessibilityState={{ busy: isSaving }} disabled={isSaving} onPress={handleSave}>
          <Text style={styles.saveBtnText}>{isSaving ? 'Saving routine…' : 'Save routine'}</Text>
        </HapticPressable>
      }
    >
        <Text style={styles.overline}>Routine name</Text>
        <TextInput
          accessibilityLabel="Routine name"
          style={styles.nameInput}
          placeholder="Routine name (e.g. Push Day)"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />
        <Text style={styles.overline}>Exercises</Text>

        {exercises.map((ex, idx) => (
          <View key={`${ex.exerciseId}-${idx}`} testID={`exercise-row-${idx}`} style={styles.exerciseCard} onLayout={({ nativeEvent }) => { rowBounds.current[idx] = nativeEvent.layout; }}>
            <View style={styles.exerciseTop}>
              <View style={styles.exerciseTopLeft}>
                <View style={styles.iconButton} accessibilityLabel={`Drag ${ex.exerciseName} to reorder`} {...dragExercise(idx)}>
                  <Ionicons name="reorder-two-outline" size={18} color={colors.textMuted} />
                </View>
                <Text style={styles.exerciseNum}>{idx + 1}</Text>
                <Text style={styles.exerciseName}>{ex.exerciseName}</Text>
              </View>
              <View style={styles.exerciseActions}>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Move ${ex.exerciseName} up`} onPress={() => moveExercise(idx, 'up')} disabled={idx === 0}>
                  <Ionicons name="chevron-up" size={18} color={idx === 0 ? colors.border : colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Move ${ex.exerciseName} down`} onPress={() => moveExercise(idx, 'down')} disabled={idx === exercises.length - 1}>
                  <Ionicons name="chevron-down" size={18} color={idx === exercises.length - 1 ? colors.border : colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Edit ${ex.exerciseName}, exercise ${idx + 1}`} onPress={() => setInputs.current[idx]?.focus()}>
                  <Ionicons name="create-outline" size={20} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Remove ${ex.exerciseName}, exercise ${idx + 1}`} onPress={() => removeExercise(idx)}>
                  <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Sets</Text>
                <TextInput
                  ref={(input) => { setInputs.current[idx] = input; }}
                  accessibilityLabel={`Sets for ${ex.exerciseName}, exercise ${idx + 1}`}
                  style={styles.fieldInput}
                  value={String(ex.sets)}
                  onChangeText={(v) => updateExerciseField(idx, 'sets', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Reps</Text>
                <TextInput
                  accessibilityLabel={`Reps for ${ex.exerciseName}, exercise ${idx + 1}`}
                  style={styles.fieldInput}
                  value={String(ex.reps)}
                  onChangeText={(v) => updateExerciseField(idx, 'reps', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rest (s)</Text>
                <TextInput
                  accessibilityLabel={`Rest seconds for ${ex.exerciseName}, exercise ${idx + 1}`}
                  style={styles.fieldInput}
                  value={String(ex.restSec)}
                  onChangeText={(v) => updateExerciseField(idx, 'restSec', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Add exercise" onPress={() => { void openAddExercise(); }}>
          <Ionicons name="add-outline" size={22} color={colors.textPrimary} />
          <Text style={styles.addBtnText}>Add exercise</Text>
        </TouchableOpacity>

      {/* Exercise Picker Modal */}
      <Modal visible={showAddModal} animationType="none" presentationStyle="pageSheet" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close exercise picker" onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add exercise</Text>
            <View style={styles.iconButton} />
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              accessibilityLabel="Search exercises"
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={handleSearchChange}
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.muscleFilter} contentContainerStyle={styles.muscleFilterContent}>
            {MUSCLES.map((m) => (
              <TouchableOpacity
                key={m}
                accessibilityRole="button"
                accessibilityLabel={`Filter ${m}`}
                accessibilityState={{ selected: selectedMuscle === m }}
                style={[styles.muscleChip, selectedMuscle === m && styles.muscleChipActive]}
                onPress={() => handleMuscleFilter(m)}
              >
                <Text style={[styles.muscleChipText, selectedMuscle === m && styles.muscleChipTextActive]}>
                  {m === 'All' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <FlatList
            keyboardShouldPersistTaps="handled"
            data={filteredExercises}
            ListEmptyComponent={<Text style={styles.exerciseListMeta}>{pickerStatus === 'loading' ? 'Loading exercises.' : pickerStatus === 'error' ? 'Exercises did not load. Check your connection and try again.' : 'No exercises match. Try another search or muscle group.'}</Text>}
            ListFooterComponent={pickerStatus === 'error' ? <TouchableOpacity style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Try loading exercises again" onPress={openAddExercise}><Text style={styles.addBtnText}>Try again</Text></TouchableOpacity> : null}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.exerciseList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.exerciseListItem} accessibilityRole="button" accessibilityLabel={`Add ${item.name}`} onPress={() => addExercise(item)} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exerciseListName}>{item.name}</Text>
                  <Text style={styles.exerciseListMeta}>
                    {item.muscle.charAt(0).toUpperCase() + item.muscle.slice(1)} · {item.equipment}
                  </Text>
                </View>
                <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  overline: { ...typography.eyebrow, color: colors.textMuted, marginBottom: 12 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topTitle: { ...typography.h2, color: colors.textPrimary },
  // Screen pins the save button above the tab bar, so no 120 pt clearance.
  content: { paddingTop: 24, paddingBottom: 24 },
  nameInput: {
    ...typography.h1,
    paddingVertical: 14,
    color: colors.textPrimary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 32,
  },
  exerciseCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: 20,
    marginBottom: 12,
  },
  exerciseTop: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: 10,
  },
  exerciseTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exerciseNum: {
    width: 24,
    ...typography.bodySmall,
    color: colors.textMuted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    lineHeight: 24,
  },
  exerciseName: { ...typography.bodyMd, color: colors.textPrimary, flex: 1 },
  exerciseActions: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end' },
  fieldRow: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  fieldLabel: { ...typography.bodySmall, fontSize: 13, color: colors.textMuted, marginBottom: 4 },
  fieldInput: {
    ...typography.body,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
    textAlign: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    paddingVertical: 16,
    marginTop: 4,
  },
  addBtnText: { ...typography.bodyMd, color: colors.textPrimary, textDecorationLine: 'underline' },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    minHeight: 54,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { ...typography.bodyMd, color: colors.textOnPrimary },
  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { ...typography.body, flex: 1, minHeight: 44, color: colors.textPrimary },
  muscleFilter: { maxHeight: 48, marginBottom: 16 },
  muscleFilterContent: { paddingHorizontal: 20, gap: 8 },
  muscleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  muscleChipActive: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.textPrimary },
  muscleChipText: { ...typography.bodySmall, color: colors.textSecondary },
  muscleChipTextActive: { color: colors.textPrimary },
  exerciseList: { paddingHorizontal: 20, paddingBottom: 40 },
  exerciseListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  exerciseListName: { ...typography.bodyMd, color: colors.textPrimary },
  exerciseListMeta: { ...typography.bodySmall, color: colors.textMuted, marginTop: 2 },

  });
