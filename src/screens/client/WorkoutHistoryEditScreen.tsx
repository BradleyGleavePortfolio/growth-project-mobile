import React, { useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';
import { useTheme } from '../../theme/ThemeProvider';
import HapticPressable from '../../components/HapticPressable';
import api from '../../services/api';
import { makeStyles as makeActiveStyles } from './active-workout/styles';
import { layout, spacing, typography } from '../../theme/tokens';
import { useScreenInsets } from '../../ui';
import { SetLogger } from './active-workout/SetLogger';
import type { SessionSet } from './active-workout/types';
import { loggedWorkoutEditPayload, loggedWorkoutExercises, type LoggedWorkout } from './active-workout/sessionQuality';

export default function WorkoutHistoryEditScreen() {
  const route = useRoute<RouteProp<WorkoutStackParamList, 'WorkoutHistoryEdit'>>();
  const navigation = useNavigation<NavigationProp<WorkoutStackParamList>>();
  const qc = useQueryClient();
  const { colors, semanticColors: sc } = useTheme();
  // The top bar starts under the real status bar (Android edge-to-edge and the
  // iPhone notch alike), not at a fixed 56 (REDO-INSETS-133).
  const insetTop = useScreenInsets().top;
  const styles = useMemo(() => {
    const base = makeActiveStyles(colors);
    return StyleSheet.create({
      ...base,
      container: { ...base.container, backgroundColor: sc.bgPrimary },
      topBar: { ...base.topBar, paddingTop: insetTop + layout.statusBarGap, backgroundColor: sc.bgPrimary, borderBottomColor: sc.border },
      topTitle: { ...base.topTitle, color: sc.textMuted },
      finishBtn: { ...base.finishBtn, minHeight: 44, justifyContent: 'center', backgroundColor: sc.accent },
      finishBtnText: { ...base.finishBtnText, color: sc.textOnAccent },
      content: { ...base.content, paddingTop: spacing.xl },
      exerciseCard: { ...base.exerciseCard, backgroundColor: sc.bgPrimary, borderBottomColor: sc.border },
      exerciseName: { ...base.exerciseName, color: sc.textPrimary },
      previousSetText: { ...base.previousSetText, color: sc.textMuted },
      addSetText: { ...base.addSetText, color: sc.textPrimary },
      setHeaderText: { ...base.setHeaderText, color: sc.textMuted },
      setText: { ...base.setText, color: sc.textMuted },
      setRow: { ...base.setRow, borderBottomColor: sc.border },
      setRowCompleted: { ...base.setRowCompleted, backgroundColor: sc.bgPrimary, borderBottomColor: sc.border },
      setInput: { ...base.setInput, color: sc.textPrimary, backgroundColor: sc.bgPrimary,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border },
      notesInput: { ...base.notesInput, color: sc.textPrimary, backgroundColor: sc.bgPrimary,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border },
    });
  }, [colors, sc, insetTop]);
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
    <View style={styles.topBar} testID="workout-history-edit-top">
      <HapticPressable intent="light" style={styles.toolButton} onPress={close} disabled={saving} accessibilityLabel="Cancel workout editing">
        <Text style={styles.addSetText}>Cancel</Text>
      </HapticPressable>
      <View style={styles.topCenter}><Text style={styles.topTitle}>Edit workout</Text></View>
      <HapticPressable intent="success" style={styles.finishBtn} onPress={() => { void save(); }} disabled={saving} accessibilityLabel="Save workout changes" accessibilityState={{ disabled: saving, busy: saving }}>
        {saving ? <ActivityIndicator color={sc.textOnAccent} /> : <Text style={styles.finishBtnText}>Save changes</Text>}
      </HapticPressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={[typography.h2, { color: sc.textPrimary, marginHorizontal: spacing.xl, marginBottom: spacing.sm }]}>{workout.workout_name || 'Saved workout'}</Text>
      <Text style={[styles.previousSetText, { marginHorizontal: 20, marginBottom: 12 }]}>Correct saved weights, reps and notes.</Text>
      {exercises.map((exercise, exIdx) => <View key={exIdx} style={styles.exerciseCard}>
        <Text style={styles.exerciseName}>{exercise.exerciseName}</Text>
        <View style={[styles.setHeaderRow, { marginTop: 12 }]}>
          <Text style={[styles.setHeaderText, { width: 36 }]}>Set</Text>
          <Text style={[styles.setHeaderText, { flex: 1 }]}>Weight (lb)</Text>
          <Text style={[styles.setHeaderText, { flex: 1 }]}>Reps</Text>
        </View>
        {exercise.sets.map((set, setIdx) => <SetLogger key={setIdx} set={set} exIdx={exIdx} setIdx={setIdx} onUpdate={updateSet} onToggleComplete={() => undefined} colors={colors} styles={styles} hideCompletion editable={!saving} />)}
        <TextInput style={styles.notesInput} value={exercise.notes ?? ''} multiline maxLength={1000} placeholder="Exercise notes" placeholderTextColor={sc.textMuted} accessibilityLabel={`Notes for ${exercise.exerciseName}`} editable={!saving} onChangeText={(value) => {
          changed.current = true;
          setExercises((prev) => prev.map((e, i) => i === exIdx ? { ...e, notes: value } : e));
        }} />
      </View>)}
      <View style={styles.exerciseCard}>
        <TextInput style={styles.notesInput} value={notes} multiline maxLength={2000} placeholder="Workout notes" placeholderTextColor={sc.textMuted} accessibilityLabel="Workout notes" editable={!saving} onChangeText={(value) => { changed.current = true; setNotes(value); }} />
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
