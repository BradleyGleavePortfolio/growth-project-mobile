import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { lightTokens as sc, radius, typography } from '../../../theme/tokens';
import { Headline } from '../../../ui';
import type { SessionExercise, SessionSet } from './types';
import type { ActiveWorkoutStyles } from './styles';
import { SetLogger } from './SetLogger';
import { blockLetter } from './blockLetter';

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
  active = false,
  foldable = false,
  notStarted = false,
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
  /** C1 v2: the exercise in progress sits on the sage card. */
  active?: boolean;
  /** C1 v2: every set is done and the client has moved on, so the block folds. */
  foldable?: boolean;
  /** C1 v2: a later block with no set done yet is one line with its plan until tapped. */
  notStarted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const folded = foldable && !open;
  const waiting = notStarted && !open && !active;
  const done = exercise.sets.length > 0 && exercise.sets.every((set) => set.completed);
  // The first set still to do gets the filled "As planned" in the active block.
  const nextSet = active ? exercise.sets.findIndex((set) => !set.completed) : -1;
  const summary = (
    <Text style={styles.exerciseSummary}>
      {exercise.sets.filter((set) => set.completed).length} of {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'} complete
    </Text>
  );
  // C1 v2 (MOCKUP3/C1/style-c-v2/C2_logger): lettered blocks A, B, C...
  const letter = (
    <View style={[local.letter, done ? local.letterDone : active ? local.letterActive : local.letterOpen]}
      testID={`exercise-letter-${exIdx}`} accessible={false} importantForAccessibility="no-hide-descendants">
      {done
        ? <Ionicons name="checkmark" size={16} color={sc.textOnAccent} />
        : <Text style={[local.letterText, { color: active ? sc.textOnAccent : sc.accentText }]}>{blockLetter(exIdx)}</Text>}
    </View>
  );
  // C1 v2: "C  Romanian deadlift  3 × 8 · 135 lb", one tap opens the block.
  if (waiting) {
    const plan = planLine(exercise.sets, exercise.unit === 'seconds');
    return (
      <HapticPressable intent="light" style={styles.exerciseCard} onPress={() => setOpen(true)}
        accessibilityRole="button" accessibilityState={{ expanded: false }}
        accessibilityLabel={`Show sets for ${exercise.exerciseName}${plan ? `, ${plan}` : ''}`}
        testID={`exercise-waiting-${exIdx}`}>
        <View style={[styles.exerciseHeader, local.foldedHeader]}>
          {letter}
          <View style={styles.exerciseHeaderText}>
            <Text style={styles.exerciseName}>{exercise.exerciseName}</Text>
            {plan ? <Text style={styles.exerciseSummary}>{plan}</Text> : null}
          </View>
        </View>
      </HapticPressable>
    );
  }
  if (folded) {
    const sets = exercise.sets.length;
    return (
      <HapticPressable intent="light" style={styles.exerciseCard} onPress={() => setOpen(true)}
        accessibilityRole="button" accessibilityState={{ expanded: false }}
        accessibilityLabel={`Show sets for ${exercise.exerciseName}, ${sets} of ${sets} ${sets === 1 ? 'set' : 'sets'} complete`}
        testID={`exercise-folded-${exIdx}`}>
        <View style={[styles.exerciseHeader, local.foldedHeader]}>
          {letter}
          <View style={styles.exerciseHeaderText}>
            <Text style={styles.exerciseName}>{`${blockLetter(exIdx)} · ${exercise.exerciseName}`}</Text>
            {summary}
          </View>
          <Ionicons name="chevron-down" size={20} color={sc.textPrimary} />
        </View>
      </HapticPressable>
    );
  }
  return (
    <View style={[styles.exerciseCard, active && local.activeCard]} testID={active ? `exercise-active-${exIdx}` : undefined}>
      <View pointerEvents={disabled ? 'none' : 'auto'}>
      {/* C1 v2: a lettered block; the open one is the sage card. */}
      <View style={styles.exerciseHeader}>
        {letter}
        <View style={styles.exerciseHeaderText}>
          <Headline level="h3">{exercise.exerciseName}</Headline>
          {summary}
        </View>
        {foldable ? (
          <HapticPressable intent="light" style={styles.toolButton} onPress={() => setOpen(false)}
            accessibilityRole="button" accessibilityState={{ expanded: true }} accessibilityLabel={`Hide sets for ${exercise.exerciseName}`}>
            <Ionicons name="chevron-up" size={20} color={sc.textPrimary} />
          </HapticPressable>
        ) : null}
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

      {/* C1 v2: each set is its own text row ("Set 2  155 lb × 6"), so no column headers. */}

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
          nextUp={setIdx === nextSet}
          timed={exercise.unit === 'seconds'}
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

/**
 * C1 v2 plan line from the block's first set: "3 × 8 · 135 lb"; a coach's zero
 * stays "0 lb". TIMED-SETS-M: a timed block reads "3 × 60 sec".
 */
export function planLine(sets: SessionSet[], timed = false): string {
  const first = sets[0];
  if (!first) return '';
  const weight = first.weight > 0 || first.prescribedZero ? ` · ${first.weight} lb` : '';
  return first.reps > 0 ? `${sets.length} × ${first.reps}${timed ? ' sec' : ''}${weight}` : `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}${weight}`;
}

export { blockLetter };

const local = StyleSheet.create({
  // The block letter beside the exercise name; decorative, so screen readers skip it.
  letter: { width: 32, height: 32, borderRadius: radius.input, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  letterOpen: { borderWidth: 1, borderColor: sc.accentText, backgroundColor: 'transparent' },
  letterActive: { backgroundColor: sc.accent },
  letterDone: { backgroundColor: sc.accent },
  letterText: { ...typography.h3, fontSize: 17, lineHeight: 22 },
  foldedHeader: { marginBottom: 0, alignItems: 'center' },
  // C1 v2: the exercise in progress on a sage card with a sage line.
  activeCard: {
    backgroundColor: sc.surface.sage,
    borderWidth: 1,
    borderColor: sc.surface.sageLine,
    borderBottomColor: sc.surface.sageLine,
    borderRadius: radius.card,
    paddingHorizontal: 16,
    marginVertical: 12,
  },
});
