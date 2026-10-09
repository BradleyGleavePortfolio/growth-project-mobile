import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { lightTokens as sc, typography } from '../../../theme/tokens';
import { Headline } from '../../../ui';
import type { SessionExercise, SessionSet } from './types';
import type { ActiveWorkoutStyles } from './styles';
import { SetLogger } from './SetLogger';

export function ExerciseCard({
  exercise,
  exIdx,
  onUpdateSet,
  onToggleSetComplete,
  onAddSet,
  onRemoveExercise,
  onOpenExerciseDetail,
  colors,
  styles,
  previous,
  onMove,
  onSwap,
  onChangeNotes,
  onChangeRest,
  isLast,
  disabled = false,
}: {
  exercise: SessionExercise;
  exIdx: number;
  onUpdateSet: <K extends keyof SessionSet>(exIdx: number, setIdx: number, field: K, value: SessionSet[K]) => void;
  onToggleSetComplete: (exIdx: number, setIdx: number) => void;
  onAddSet: (exIdx: number) => void;
  onRemoveExercise: (exIdx: number) => void;
  onOpenExerciseDetail: (exercise: SessionExercise) => void;
  colors: ThemeColors;
  styles: ActiveWorkoutStyles;
  previous?: SessionSet[];
  onMove?: (index: number, direction: -1 | 1) => void;
  onSwap?: (index: number) => void;
  onChangeNotes?: (index: number, notes: string) => void;
  onChangeRest?: (index: number, seconds: number) => void;
  isLast?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={styles.exerciseCard}>
      <View pointerEvents={disabled ? 'none' : 'auto'}>
      {/* REDO-LIVE-133: numbered serif title, as in the clientfile-workouts reference. */}
      <View style={styles.exerciseHeader}>
        <Text style={[local.index, { color: sc.textMuted }]} accessible={false} importantForAccessibility="no">
          {exIdx + 1}
        </Text>
        <View style={styles.exerciseHeaderText}>
          <Headline level="h3">{exercise.exerciseName}</Headline>
          <Text style={styles.exerciseSummary}>
            {exercise.sets.filter((set) => set.completed).length} of {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'} complete
          </Text>
        </View>
      </View>
      {/* FU-WORKLOG-126: the coach's note used to show only on the screen
          before Start, never while the client was doing the sets. */}
      {exercise.coachNote ? (
        <Text style={styles.coachNote} testID={`coach-note-${exIdx}`}>
          Coach note: {exercise.coachNote}
        </Text>
      ) : null}
      <View style={styles.exerciseTools}>
          {/* Mux video v1 — tap to open the catalog detail (modal). The
              legacy exercise id ≠ catalog id, so we open by slug
              derived from the name. Detail screen handles the
              "Exercise not found" case gracefully if it doesn't
              resolve. v2 will store a stable catalog ref on the
              session exercise so this is exact. */}
          <HapticPressable
            intent="light"
            style={styles.toolButton}
            onPress={() => onOpenExerciseDetail(exercise)}
            accessibilityLabel={`Watch video for ${exercise.exerciseName}`}
          >
            <Ionicons name="play-circle-outline" size={24} color={sc.textMuted} />
          </HapticPressable>
          <HapticPressable
            intent="warning"
            style={styles.toolButton}
            onPress={() => onRemoveExercise(exIdx)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${exercise.exerciseName}`}
            testID={`remove-exercise-${exIdx}`}
          >
            <Ionicons name="trash-outline" size={24} color={sc.textMuted} />
          </HapticPressable>
      {onMove && <>
        <HapticPressable intent="light" style={[styles.toolButton, exIdx === 0 && styles.toolButtonDisabled]} disabled={exIdx === 0} onPress={() => onMove(exIdx, -1)} accessibilityLabel={`Move ${exercise.exerciseName} up`}>
          <Ionicons name="arrow-up-outline" size={24} color={sc.textMuted} />
        </HapticPressable>
        <HapticPressable intent="light" style={[styles.toolButton, isLast && styles.toolButtonDisabled]} disabled={isLast} onPress={() => onMove(exIdx, 1)} accessibilityLabel={`Move ${exercise.exerciseName} down`}>
          <Ionicons name="arrow-down-outline" size={24} color={sc.textMuted} />
        </HapticPressable>
        <HapticPressable intent="light" style={styles.toolButton} onPress={() => onSwap?.(exIdx)} accessibilityLabel={`Swap ${exercise.exerciseName}`}>
          <Ionicons name="swap-horizontal-outline" size={24} color={sc.textMuted} />
        </HapticPressable>
      </>}
      </View>
      {onMove && <View style={styles.exerciseRestTools}>
        <Text style={styles.setHeaderText}>Rest</Text>
        {[60, 90, 120].map((seconds) => <HapticPressable key={seconds} intent="light" style={styles.toolButton} onPress={() => onChangeRest?.(exIdx, seconds)} accessibilityLabel={`Set rest for ${exercise.exerciseName} to ${seconds} seconds`} accessibilityState={{ selected: exercise.restSec === seconds }}>
          <Text style={[styles.addSetText, exercise.restSec !== seconds && { color: sc.textMuted }]}>{seconds}s</Text>
        </HapticPressable>)}
      </View>}
      {onChangeRest && ![60, 90, 120].includes(exercise.restSec ?? 0) && <Text style={styles.previousSetText}>Rest: {exercise.restSec ?? 0}s · From the plan</Text>}

      {/* Set Headers */}
      <View style={styles.setHeaderRow}>
        <Text style={[styles.setHeaderText, { width: 36 }]}>Set</Text>
        <Text style={[styles.setHeaderText, { flex: 1 }]}>Weight (lbs)</Text>
        <Text style={[styles.setHeaderText, { flex: 1 }]}>Reps</Text>
        <View style={{ width: 44 }} />
      </View>

      {exercise.sets.map((set, setIdx) => (
        <SetLogger
          key={setIdx}
          set={set}
          setIdx={setIdx}
          exIdx={exIdx}
          onUpdate={onUpdateSet}
          onToggleComplete={onToggleSetComplete}
          colors={colors}
          styles={styles}
          previous={previous?.[setIdx]}
          editable={!disabled}
        />
      ))}

      <HapticPressable intent="medium" style={styles.addSetBtn} onPress={() => onAddSet(exIdx)} accessibilityRole="button">
        <Ionicons name="add-outline" size={20} color={colors.primary} />
        <Text style={styles.addSetText}>Add set</Text>
      </HapticPressable>
      {onChangeNotes && <TextInput
        style={styles.notesInput}
        value={exercise.notes ?? ''}
        onChangeText={(notes) => onChangeNotes(exIdx, notes)}
        placeholder="Exercise notes"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={`Notes for ${exercise.exerciseName}`}
        maxLength={1000}
        multiline
        editable={!disabled}
      />}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  // Serif tabular index beside the exercise name; decorative, so screen readers skip it.
  index: { ...typography.h3, fontVariant: ['tabular-nums'], minWidth: 18 },
});
