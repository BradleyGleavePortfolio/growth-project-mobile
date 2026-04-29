import React, { useState, useEffect, useMemo } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';

import { getAllExercises } from '../../db/workoutDb';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import {
  useRoutines,
  useCreateRoutine,
  useUpdateRoutine,
  useDeleteRoutine,
} from '../../hooks/useApi';

interface RoutineExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  restSec: number;
}

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

  // Load existing routine via React Query so the cache is shared with the
  // routines list elsewhere in the app. When the screen is opened in "new"
  // mode (no routineId) the query simply isn't needed for hydration.
  const routinesQ = useRoutines();
  const createRoutine = useCreateRoutine();
  const updateRoutine = useUpdateRoutine();
  const deleteRoutine = useDeleteRoutine();

  useEffect(() => {
    if (!routineId || !routinesQ.data) return;
    const routine = routinesQ.data.find((r) => r.id === routineId);
    if (!routine) return;
    setName(routine.name);
    type Ex = { exercise_id?: string; exerciseId?: string; exercise_name?: string; exerciseName?: string; sets?: number; reps?: number; rest_sec?: number; restSec?: number };
    const exs = ((routine.exercises as Ex[] | undefined) || []).map((e) => ({
      exerciseId: e.exercise_id || e.exerciseId || '',
      exerciseName: e.exercise_name || e.exerciseName || '',
      sets: e.sets || 3,
      reps: e.reps || 10,
      restSec: e.rest_sec || e.restSec || 60,
    }));
    setExercises(exs);
  }, [routineId, routinesQ.data]);

  const openAddExercise = async () => {
    setShowAddModal(true);
    setSearchQuery('');
    setSelectedMuscle('All');
    const all = await getAllExercises();
    setAllExercises(all);
    setFilteredExercises(all);
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

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Give your routine a name.');
      return;
    }
    if (exercises.length === 0) {
      Alert.alert('No Exercises', 'Add at least one exercise.');
      return;
    }
    const payload = {
      name: name.trim(),
      exercises: exercises.map((e) => ({
        exercise_name: e.exerciseName,
        sets: e.sets,
        reps: e.reps,
        rest_sec: e.restSec,
      })),
    };
    const onSuccess = () => navigation.goBack();
    const onError = (err: unknown) => {
      Alert.alert("Couldn't save routine", errorMessage(err, 'Please try again.'));
    };
    if (routineId) {
      updateRoutine.mutate({ id: routineId, data: payload }, { onSuccess, onError });
    } else {
      createRoutine.mutate(payload, { onSuccess, onError });
    }
  };

  const handleDelete = () => {
    if (!routineId) return;
    Alert.alert('Delete Routine?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRoutine.mutate(routineId, {
            onSuccess: () => navigation.goBack(),
            onError: (err) => {
              Alert.alert("Couldn't delete routine", errorMessage(err, 'Please try again.'));
            },
          });
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{routineId ? 'Edit Routine' : 'New Routine'}</Text>
        {routineId ? (
          <TouchableOpacity onPress={handleDelete}>
            <Ionicons name="trash-outline" size={22} color={colors.error} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TextInput
          style={styles.nameInput}
          placeholder="Routine name (e.g. Push Day)"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />

        {exercises.map((ex, idx) => (
          <View key={`${ex.exerciseId}-${idx}`} style={styles.exerciseCard}>
            <View style={styles.exerciseTop}>
              <View style={styles.exerciseTopLeft}>
                <Text style={styles.exerciseNum}>{idx + 1}</Text>
                <Text style={styles.exerciseName}>{ex.exerciseName}</Text>
              </View>
              <View style={styles.exerciseActions}>
                <TouchableOpacity onPress={() => moveExercise(idx, 'up')} disabled={idx === 0}>
                  <Ionicons name="chevron-up" size={18} color={idx === 0 ? colors.border : colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => moveExercise(idx, 'down')} disabled={idx === exercises.length - 1}>
                  <Ionicons name="chevron-down" size={18} color={idx === exercises.length - 1 ? colors.border : colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeExercise(idx)}>
                  <Ionicons name="close-circle" size={18} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Sets</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={String(ex.sets)}
                  onChangeText={(v) => updateExerciseField(idx, 'sets', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Reps</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={String(ex.reps)}
                  onChangeText={(v) => updateExerciseField(idx, 'reps', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rest (s)</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={String(ex.restSec)}
                  onChangeText={(v) => updateExerciseField(idx, 'restSec', parseInt(v) || 0)}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} onPress={openAddExercise}>
          <Ionicons name="add-circle" size={22} color={colors.primary} />
          <Text style={styles.addBtnText}>Add Exercise</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.8}>
          <Text style={styles.saveBtnText}>{routineId ? 'Update Routine' : 'Save Routine'}</Text>
        </TouchableOpacity>
      </View>

      {/* Exercise Picker Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Exercise</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
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
            data={filteredExercises}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.exerciseList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.exerciseListItem} onPress={() => addExercise(item)} activeOpacity={0.7}>
                <View>
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
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topTitle: { fontSize: 17, fontWeight: '500', color: colors.textPrimary },
  content: { padding: 20, paddingBottom: 120 },
  nameInput: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  exerciseCard: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    marginBottom: 10,
  },
  exerciseTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  exerciseTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  exerciseNum: {
    width: 24,
    height: 24,
    borderRadius: 2, // radius.md
    backgroundColor: colors.primary,
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 24,
    overflow: 'hidden',
  },
  exerciseName: { fontSize: 15, fontWeight: '500', color: colors.textPrimary, flex: 1 },
  exerciseActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  field: { flex: 1 },
  fieldLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  fieldInput: {
    backgroundColor: colors.background,
    borderRadius: 0, // radius.sm
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addBtnText: { fontSize: 15, fontWeight: '500', color: colors.primary },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnText: { color: colors.textOnPrimary, fontSize: 17, fontWeight: '500' },
  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '500', color: colors.textPrimary },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 2, // radius.md
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.textPrimary },
  muscleFilter: { maxHeight: 44, marginBottom: 8 },
  muscleFilterContent: { paddingHorizontal: 20, gap: 8 },
  muscleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  muscleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  muscleChipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  muscleChipTextActive: { color: colors.textOnPrimary },
  exerciseList: { paddingHorizontal: 20, paddingBottom: 40 },
  exerciseListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  exerciseListName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  exerciseListMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  });
