import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { ThemeColors } from '../../../theme/ThemeProvider';
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
      <View style={styles.exerciseHeader}>
        <Text style={styles.exerciseName}>{exercise.exerciseName}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {/* Mux video v1 — tap to open the catalog detail (modal). The
              legacy exercise id ≠ catalog id, so we open by slug
              derived from the name. Detail screen handles the
              "Exercise not found" case gracefully if it doesn't
              resolve. v2 will store a stable catalog ref on the
              session exercise so this is exact. */}
          <HapticPressable
            intent="light"
            onPress={() => onOpenExerciseDetail(exercise)}
            accessibilityLabel={`Watch video for ${exercise.exerciseName}`}
          >
            <Ionicons name="play-circle-outline" size={22} color={colors.textMuted} />
          </HapticPressable>
          <HapticPressable
            intent="warning"
            onPress={() => onRemoveExercise(exIdx)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${exercise.exerciseName}`}
            testID={`remove-exercise-${exIdx}`}
          >
            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
          </HapticPressable>
        </View>
      </View>
      {/* FU-WORKLOG-126: the coach's note used to show only on the screen
          before Start, never while the client was doing the sets. */}
      {exercise.coachNote ? (
        <Text style={[styles.previousSetText, { marginTop: 4 }]} testID={`coach-note-${exIdx}`}>
          Coach note: {exercise.coachNote}
        </Text>
      ) : null}
      {onMove && <View style={styles.exerciseTools}>
        <HapticPressable intent="light" style={styles.toolButton} disabled={exIdx === 0} onPress={() => onMove(exIdx, -1)} accessibilityLabel={`Move ${exercise.exerciseName} up`}>
          <Ionicons name="arrow-up" size={18} color={exIdx === 0 ? colors.textMuted : colors.primary} />
        </HapticPressable>
        <HapticPressable intent="light" style={styles.toolButton} disabled={isLast} onPress={() => onMove(exIdx, 1)} accessibilityLabel={`Move ${exercise.exerciseName} down`}>
          <Ionicons name="arrow-down" size={18} color={isLast ? colors.textMuted : colors.primary} />
        </HapticPressable>
        <HapticPressable intent="light" style={styles.toolButton} onPress={() => onSwap?.(exIdx)} accessibilityLabel={`Swap ${exercise.exerciseName}`}>
          <Text style={styles.addSetText}>Swap</Text>
        </HapticPressable>
        <Text style={[styles.setHeaderText, { marginLeft: 'auto' }]}>Rest</Text>
        {[60, 90, 120].map((seconds) => <HapticPressable key={seconds} intent="light" style={styles.toolButton} onPress={() => onChangeRest?.(exIdx, seconds)} accessibilityLabel={`Set rest for ${exercise.exerciseName} to ${seconds} seconds`} accessibilityState={{ selected: exercise.restSec === seconds }}>
          <Text style={[styles.addSetText, exercise.restSec !== seconds && { color: colors.textMuted }]}>{seconds}s</Text>
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

      <HapticPressable intent="medium" style={styles.addSetBtn} onPress={() => onAddSet(exIdx)}>
        <Ionicons name="add" size={16} color={colors.primary} />
        <Text style={styles.addSetText}>Add Set</Text>
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
