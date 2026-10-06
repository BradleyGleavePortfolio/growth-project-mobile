import React, { useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';
import { useTheme } from '../../theme/ThemeProvider';
import HapticPressable from '../../components/HapticPressable';
import api from '../../services/api';
import { makeStyles } from './active-workout/styles';
import { SetLogger } from './active-workout/SetLogger';
import type { SessionSet } from './active-workout/types';
import { loggedWorkoutEditPayload, loggedWorkoutExercises, type LoggedWorkout } from './active-workout/sessionQuality';

export default function WorkoutHistoryEditScreen() {
  const route = useRoute<RouteProp<WorkoutStackParamList, 'WorkoutHistoryEdit'>>();
  const navigation = useNavigation<NavigationProp<WorkoutStackParamList>>();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const workout = useMemo(() => JSON.parse(route.params.workout) as LoggedWorkout, [route.params.workout]);
  const [exercises, setExercises] = useState(() => loggedWorkoutExercises(workout));
  const [notes, setNotes] = useState(workout.notes ?? '');
  const [saving, setSaving] = useState(false);
  const changed = useRef(false);

  const updateSet = <K extends keyof SessionSet>(exIdx: number, setIdx: number, field: K, value: SessionSet[K]) => {
    changed.current = true;
    setExercises((prev) => prev.map((ex, i) => i === exIdx ? {
      ...ex, sets: ex.sets.map((set, j) => j === setIdx ? { ...set, [field]: value } : set),
    } : ex));
  };

  const close = () => {
    if (!changed.current) { navigation.goBack(); return; }
    Alert.alert('Discard workout changes?', 'The saved workout stays unchanged.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/workouts/${encodeURIComponent(workout.id)}`, loggedWorkoutEditPayload(workout, exercises, notes));
      void qc.invalidateQueries({ queryKey: ['workouts'] });
      changed.current = false;
      navigation.goBack();
    } catch {
      Alert.alert('Workout changes not saved', 'The entries stay on this screen. Check the connection, then tap Save changes again.');
      setSaving(false);
    }
  };

  return <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.topBar}>
      <HapticPressable intent="light" style={styles.toolButton} onPress={close} disabled={saving} accessibilityLabel="Cancel workout editing">
        <Text style={styles.addSetText}>Cancel</Text>
      </HapticPressable>
      <View style={styles.topCenter}><Text style={styles.topTitle} numberOfLines={2}>{workout.workout_name || 'Edit workout'}</Text></View>
      <HapticPressable intent="success" style={styles.finishBtn} onPress={() => { void save(); }} disabled={saving} accessibilityLabel="Save workout changes" accessibilityState={{ disabled: saving, busy: saving }}>
        {saving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.finishBtnText}>Save changes</Text>}
      </HapticPressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={[styles.previousSetText, { marginHorizontal: 20, marginBottom: 12 }]}>Correct saved weights, reps and notes.</Text>
      {exercises.map((exercise, exIdx) => <View key={exIdx} style={styles.exerciseCard}>
        <Text style={styles.exerciseName}>{exercise.exerciseName}</Text>
        <View style={[styles.setHeaderRow, { marginTop: 12 }]}>
          <Text style={[styles.setHeaderText, { width: 36 }]}>Set</Text>
          <Text style={[styles.setHeaderText, { flex: 1 }]}>Weight (lb)</Text>
          <Text style={[styles.setHeaderText, { flex: 1 }]}>Reps</Text>
        </View>
        {exercise.sets.map((set, setIdx) => <SetLogger key={setIdx} set={set} exIdx={exIdx} setIdx={setIdx} onUpdate={updateSet} onToggleComplete={() => undefined} colors={colors} styles={styles} hideCompletion editable={!saving} />)}
        <TextInput style={styles.notesInput} value={exercise.notes ?? ''} multiline maxLength={1000} placeholder="Exercise notes" placeholderTextColor={colors.textMuted} accessibilityLabel={`Notes for ${exercise.exerciseName}`} editable={!saving} onChangeText={(value) => {
          changed.current = true;
          setExercises((prev) => prev.map((e, i) => i === exIdx ? { ...e, notes: value } : e));
        }} />
      </View>)}
      <View style={styles.exerciseCard}>
        <TextInput style={styles.notesInput} value={notes} multiline maxLength={2000} placeholder="Workout notes" placeholderTextColor={colors.textMuted} accessibilityLabel="Workout notes" editable={!saving} onChangeText={(value) => { changed.current = true; setNotes(value); }} />
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
