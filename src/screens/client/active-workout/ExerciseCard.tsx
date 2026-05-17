import React from 'react';
import { Text, View } from 'react-native';
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
}) {
  return (
    <View style={styles.exerciseCard}>
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
          <HapticPressable intent="warning" onPress={() => onRemoveExercise(exIdx)}>
            <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
          </HapticPressable>
        </View>
      </View>

      {/* Set Headers */}
      <View style={styles.setHeaderRow}>
        <Text style={[styles.setHeaderText, { width: 36 }]}>Set</Text>
        <Text style={[styles.setHeaderText, { flex: 1 }]}>Weight (lbs)</Text>
        <Text style={[styles.setHeaderText, { flex: 1 }]}>Reps</Text>
        <View style={{ width: 36 }} />
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
        />
      ))}

      <HapticPressable intent="medium" style={styles.addSetBtn} onPress={() => onAddSet(exIdx)}>
        <Ionicons name="add" size={16} color={colors.primary} />
        <Text style={styles.addSetText}>Add Set</Text>
      </HapticPressable>
    </View>
  );
}
