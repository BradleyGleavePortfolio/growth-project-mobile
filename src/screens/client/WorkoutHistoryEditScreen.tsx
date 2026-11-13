import React, { useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';
import { useTheme } from '../../theme/ThemeProvider';
import HapticPressable from '../../components/HapticPressable';
import api from '../../services/api';
import { makeStyles as makeActiveStyles } from './active-workout/styles';
import { layout, radius, spacing, typography } from '../../theme/tokens';
import { useScreenInsets } from '../../ui';
import { SetLogger } from './active-workout/SetLogger';
import type { SessionSet } from './active-workout/types';
import { isTimedRow } from '../../utils/workout/exerciseUnit';
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
      // STYLE-WORKOUTS-M, nearest picked drawing C2_logger (no frame draws this screen): each exercise is the open
      // block card, sage with a 1 pt sage line, 16 pt corners and padding (rows 462-1065, cols 48-82), 16 pt apart.
      // These overrides are this screen's own; active-workout/styles.ts and the live workout do not change.
      exerciseCard: { ...base.exerciseCard, backgroundColor: sc.surface.sage, borderWidth: 1, borderColor: sc.surface.sageLine,
        borderBottomWidth: 1, borderBottomColor: sc.surface.sageLine, borderRadius: radius.card, padding: spacing.lg,
        paddingVertical: spacing.lg, marginBottom: spacing.lg },
      // The card's title in Cormorant, as C2_logger draws "Bench press" (rows 509-556).
      exerciseName: { ...base.exerciseName, ...typography.h2, color: sc.textPrimary },
      notesBlock: { marginHorizontal: layout.gutter },
      previousSetText: { ...base.previousSetText, color: sc.textMuted },
      addSetText: { ...base.addSetText, color: sc.textPrimary },
      setHeaderText: { ...base.setHeaderText, color: sc.textMuted },
      setText: { ...base.setText, color: sc.textMuted },
      // Set rows sit on the card with no rule; the fields are lifted onto the surface (C2_logger rows 762-873).
      setRow: { ...base.setRow, borderBottomWidth: 0 },
      setRowCompleted: { ...base.setRowCompleted, backgroundColor: sc.surface.sage, borderBottomWidth: 0 },
      setInput: { ...base.setInput, color: sc.textPrimary, backgroundColor: sc.bgSurface, borderColor: sc.surface.sageLine,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.surface.sageLine },
      notesInput: { ...base.notesInput, color: sc.textPrimary, backgroundColor: sc.bgSurface, borderColor: sc.surface.sageLine,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.surface.sageLine },
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

  // SET-EDIT-M: remove one saved set, no ask (Cancel asks before anything is
  // dropped; nothing is sent until Save changes). An exercise whose last set
  // goes stays, sent with 0 sets so its notes and the coach's ask are kept
  // (operator ruling 11-10). The count keys the rows: after a removal they
  // remount, so a removed row's field state never moves onto the next set.
  const [cuts, setCuts] = useState<number[]>([]);
  const totalSets = exercises.reduce((n, e) => n + e.sets.length, 0);
  const removeSet = (exIdx: number, setIdx: number) => {
    changed.current = true;
    setExercises((prev) => prev.map((ex, i) => i === exIdx ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) } : ex));
    setCuts((prev) => { const next = [...prev]; next[exIdx] = (next[exIdx] ?? 0) + 1; return next; });
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
        {exercise.sets.length === 0 ? <Text style={[styles.previousSetText, { marginTop: 12 }]}>No sets left</Text> : <View style={[styles.setHeaderRow, { marginTop: 12 }]}>
          <Text style={[styles.setHeaderText, { width: 36 }]}>Set</Text>
          <Text style={[styles.setHeaderText, { flex: 1 }]}>Weight (lb)</Text>
          {/* LS-928 B1: a saved timed exercise is edited in seconds (K3-S-41). */}
          <Text style={[styles.setHeaderText, { flex: 1 }]}>{isTimedRow(exercise) ? 'Seconds' : 'Reps'}</Text>
        </View>}
        {exercise.sets.map((set, setIdx) => <SetLogger key={`${cuts[exIdx] ?? 0}-${setIdx}`} set={set} exIdx={exIdx} setIdx={setIdx} onUpdate={updateSet} onToggleComplete={() => undefined} colors={colors} styles={styles} hideCompletion editable={!saving} timed={isTimedRow(exercise)}
          // The one set left in the workout has no remove: Train's "Delete this workout" removes a whole workout.
          onRemove={totalSets > 1 ? removeSet : undefined} exerciseName={exercise.exerciseName} />)}
        <TextInput style={styles.notesInput} value={exercise.notes ?? ''} multiline maxLength={1000} placeholder="Exercise notes" placeholderTextColor={sc.textMuted} accessibilityLabel={`Notes for ${exercise.exerciseName}`} editable={!saving} onChangeText={(value) => {
          changed.current = true;
          setExercises((prev) => prev.map((e, i) => i === exIdx ? { ...e, notes: value } : e));
        }} />
      </View>)}
      <View style={styles.notesBlock}>
        <TextInput style={styles.notesInput} value={notes} multiline maxLength={2000} placeholder="Workout notes" placeholderTextColor={sc.textMuted} accessibilityLabel="Workout notes" editable={!saving} onChangeText={(value) => { changed.current = true; setNotes(value); }} />
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
