import React, { useState, useEffect, useRef } from 'react';
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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../constants/colors';
import { workoutApi } from '../../services/api';
import {
  searchExercises,
  getAllExercises,
} from '../../db/workoutDb';

interface SessionExercise {
  exerciseId: string;
  exerciseName: string;
  sets: SessionSet[];
}

interface SessionSet {
  reps: number;
  weight: number;
  completed: boolean;
}

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
  ActiveWorkout: {
    routineId?: string;
    routineName: string;
    exercises: string;
  };
};

const MUSCLES = ['All', 'chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'core', 'full body', 'cardio'];

export default function ActiveWorkoutScreen() {
  const route = useRoute<RouteProp<RouteParams, 'ActiveWorkout'>>();
  const navigation = useNavigation<any>();
  const { routineId, routineName, exercises: exercisesJson } = route.params;

  const [userId, setUserId] = useState<string | null>(null);
  const [sessionExercises, setSessionExercises] = useState<SessionExercise[]>([]);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredExercises, setFilteredExercises] = useState<Exercise[]>([]);
  const [selectedMuscle, setSelectedMuscle] = useState('All');

  useEffect(() => {
    // Parse routine exercises into session format
    try {
      const routineExs: RoutineExercise[] = JSON.parse(exercisesJson);
      const sessionExs: SessionExercise[] = routineExs.map((re) => ({
        exerciseId: re.exerciseId,
        exerciseName: re.exerciseName,
        sets: Array.from({ length: re.sets }, () => ({ reps: re.reps, weight: 0, completed: false })),
      }));
      setSessionExercises(sessionExs);
    } catch {
      setSessionExercises([]);
    }
  }, []);

  useEffect(() => {
    // Load user from AsyncStorage
    AsyncStorage.getItem('user_data').then((raw) => {
      if (raw) {
        const parsed = JSON.parse(raw);
        setUserId(parsed.id);
      }
    });
  }, []);

  useEffect(() => {
    // Start timer
    timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatTime = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const updateSet = (exIdx: number, setIdx: number, field: keyof SessionSet, value: any) => {
    setSessionExercises((prev) => {
      const updated = [...prev];
      const sets = [...updated[exIdx].sets];
      sets[setIdx] = { ...sets[setIdx], [field]: value };
      updated[exIdx] = { ...updated[exIdx], sets };
      return updated;
    });
  };

  const toggleSetComplete = (exIdx: number, setIdx: number) => {
    updateSet(exIdx, setIdx, 'completed', !sessionExercises[exIdx].sets[setIdx].completed);
  };

  const addSet = (exIdx: number) => {
    setSessionExercises((prev) => {
      const updated = [...prev];
      const lastSet = updated[exIdx].sets[updated[exIdx].sets.length - 1];
      updated[exIdx] = {
        ...updated[exIdx],
        sets: [...updated[exIdx].sets, { reps: lastSet?.reps || 10, weight: lastSet?.weight || 0, completed: false }],
      };
      return updated;
    });
  };

  const removeExercise = (exIdx: number) => {
    setSessionExercises((prev) => prev.filter((_, i) => i !== exIdx));
  };

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
    if (muscle !== 'All') {
      results = results.filter((e) => e.muscle === muscle);
    }
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

  const addExerciseToSession = (exercise: Exercise) => {
    setSessionExercises((prev) => [
      ...prev,
      {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        sets: [{ reps: 10, weight: 0, completed: false }],
      },
    ]);
    setShowAddModal(false);
  };

  const finishWorkout = () => {
    const completedSets = sessionExercises.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0);
    if (completedSets === 0) {
      Alert.alert('No sets completed', 'Complete at least one set before finishing.');
      return;
    }
    Alert.alert('Finish Workout?', `${completedSets} sets completed`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          try {
            await workoutApi.create({
              date: new Date().toISOString(),
              duration_minutes: Math.round(timer / 60),
              notes: routineName,
              exercises: sessionExercises
                .filter((e) => e.sets.some((s) => s.completed))
                .map((e) => ({
                  exercise_name: e.exerciseName,
                  sets_completed: e.sets.filter((s) => s.completed).length,
                  weight_per_set: e.sets.filter((s) => s.completed).map((s) => s.weight),
                  reps_per_set: e.sets.filter((s) => s.completed).map((s) => s.reps),
                })),
            });
          } catch (err) {
            console.error('Failed to save workout:', err);
          }
          if (timerRef.current) clearInterval(timerRef.current);
          navigation.goBack();
        },
      },
    ]);
  };

  const cancelWorkout = () => {
    Alert.alert('Cancel Workout?', 'Progress will not be saved.', [
      { text: 'Keep Going', style: 'cancel' },
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: () => {
          if (timerRef.current) clearInterval(timerRef.current);
          navigation.goBack();
        },
      },
    ]);
  };

  const totalSets = sessionExercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  const completedSets = sessionExercises.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0);

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={cancelWorkout}>
          <Ionicons name="close" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topCenter}>
          <Text style={styles.topTitle}>{routineName}</Text>
          <Text style={styles.timerText}>{formatTime(timer)}</Text>
        </View>
        <TouchableOpacity onPress={finishWorkout} style={styles.finishBtn}>
          <Text style={styles.finishBtnText}>Finish</Text>
        </TouchableOpacity>
      </View>

      {/* Progress */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%' }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {sessionExercises.map((exercise, exIdx) => (
          <View key={`${exercise.exerciseId}-${exIdx}`} style={styles.exerciseCard}>
            <View style={styles.exerciseHeader}>
              <Text style={styles.exerciseName}>{exercise.exerciseName}</Text>
              <TouchableOpacity onPress={() => removeExercise(exIdx)}>
                <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Set Headers */}
            <View style={styles.setHeaderRow}>
              <Text style={[styles.setHeaderText, { width: 36 }]}>Set</Text>
              <Text style={[styles.setHeaderText, { flex: 1 }]}>Weight (lbs)</Text>
              <Text style={[styles.setHeaderText, { flex: 1 }]}>Reps</Text>
              <View style={{ width: 36 }} />
            </View>

            {exercise.sets.map((set, setIdx) => (
              <View key={setIdx} style={[styles.setRow, set.completed && styles.setRowCompleted]}>
                <Text style={[styles.setText, { width: 36 }]}>{setIdx + 1}</Text>
                <TextInput
                  style={[styles.setInput, { flex: 1 }]}
                  value={set.weight > 0 ? String(set.weight) : ''}
                  onChangeText={(v) => updateSet(exIdx, setIdx, 'weight', parseFloat(v) || 0)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
                <TextInput
                  style={[styles.setInput, { flex: 1 }]}
                  value={String(set.reps)}
                  onChangeText={(v) => updateSet(exIdx, setIdx, 'reps', parseInt(v) || 0)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
                <TouchableOpacity
                  style={[styles.checkBtn, set.completed && styles.checkBtnDone]}
                  onPress={() => toggleSetComplete(exIdx, setIdx)}
                >
                  <Ionicons name="checkmark" size={16} color={set.completed ? '#fff' : Colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity style={styles.addSetBtn} onPress={() => addSet(exIdx)}>
              <Ionicons name="add" size={16} color={Colors.primary} />
              <Text style={styles.addSetText}>Add Set</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity style={styles.addExerciseBtn} onPress={openAddExercise}>
          <Ionicons name="add-circle" size={22} color={Colors.primary} />
          <Text style={styles.addExerciseText}>Add Exercise</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Add Exercise Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Exercise</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={Colors.textMuted}
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
              <TouchableOpacity style={styles.exerciseListItem} onPress={() => addExerciseToSession(item)} activeOpacity={0.7}>
                <View>
                  <Text style={styles.exerciseListName}>{item.name}</Text>
                  <Text style={styles.exerciseListMeta}>
                    {item.muscle.charAt(0).toUpperCase() + item.muscle.slice(1)} · {item.equipment}
                  </Text>
                </View>
                <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topCenter: { alignItems: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  timerText: { fontSize: 20, fontWeight: '800', color: Colors.primary, marginTop: 2 },
  finishBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  finishBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  progressBar: {
    height: 3,
    backgroundColor: Colors.primaryPale,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  content: { paddingVertical: 16, paddingBottom: 100 },
  exerciseCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  exerciseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  exerciseName: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  setHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  setHeaderText: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    paddingVertical: 4,
    borderRadius: 8,
  },
  setRowCompleted: { backgroundColor: Colors.primaryPale },
  setText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center' },
  setInput: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  checkBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  checkBtnDone: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    marginTop: 4,
  },
  addSetText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  addExerciseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  addExerciseText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.textPrimary },
  muscleFilter: { maxHeight: 44, marginBottom: 8 },
  muscleFilterContent: { paddingHorizontal: 20, gap: 8 },
  muscleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  muscleChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  muscleChipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  muscleChipTextActive: { color: '#fff' },
  exerciseList: { paddingHorizontal: 20, paddingBottom: 40 },
  exerciseListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  exerciseListName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  exerciseListMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});
