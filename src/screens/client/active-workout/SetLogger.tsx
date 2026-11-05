import React, { useEffect, useState } from 'react';
import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import { lightTokens as sc } from '../../../theme/tokens';
import type { SessionSet } from './types';
import type { ActiveWorkoutStyles } from './styles';

/**
 * Clean what the client typed into a weight cell. Keeps digits and ONE
 * decimal separator (a comma is read as a decimal point), so "17.5" and
 * "17,5" both stay 17.5 while the client is still typing "17.".
 */
export function sanitizeWeightText(raw: string): string {
  const normalized = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDot = normalized.indexOf('.');
  if (firstDot === -1) return normalized;
  return (
    normalized.slice(0, firstDot + 1) +
    normalized.slice(firstDot + 1).replace(/\./g, '')
  );
}

export function sanitizeRepsText(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

export function parseWeightText(text: string): number {
  const v = parseFloat(text);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function parseRepsText(text: string): number {
  const v = parseInt(text, 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * A numeric cell that keeps the client's own text while they type.
 *
 * The previous cells were controlled by the parsed number
 * (`value={String(parseFloat(text))}`), which threw away a trailing
 * decimal point: typing 17.5 lb saved 175 lb. The draft text is now the
 * source of what is shown; the parsed number is reported upward on every
 * keystroke. When the number changes from outside (Add Set copies the
 * previous set, a resumed session), the draft follows it.
 */
function NumericCell({
  value,
  sanitize,
  parse,
  onChangeValue,
  onBlankChange,
  placeholder,
  showZero = false,
  style,
  placeholderTextColor,
  keyboardType,
  accessibilityLabel,
  testID,
  autoFocus = false,
  fit,
}: {
  value: number;
  sanitize: (raw: string) => string;
  parse: (text: string) => number;
  onChangeValue: (v: number) => void;
  onBlankChange: (blank: boolean) => void;
  placeholder: string;
  showZero?: boolean;
  style: React.ComponentProps<typeof TextInput>['style'];
  placeholderTextColor: string;
  keyboardType: 'decimal-pad' | 'number-pad';
  accessibilityLabel: string;
  testID?: string;
  autoFocus?: boolean;
  /** C1 v2 inline numbers: as wide as their digits at the user's text size, never less than `min`. */
  fit?: { min: number; size: number };
}) {
  const { fontScale } = useWindowDimensions();
  const [text, setText] = useState(value > 0 || showZero ? String(value) : '');
  useEffect(() => {
    setText((cur) => {
      if (parse(cur) === value && !(cur === '' && showZero)) return cur;
      return value > 0 || showZero ? String(value) : '';
    });
  }, [value, parse, showZero]);
  useEffect(() => { onBlankChange(text === ''); }, [text, onBlankChange]);
  return (
    <TextInput
      style={fit ? [style, { width: Math.max(fit.min, Math.ceil((text || placeholder).length * fit.size * 0.62 * (fontScale || 1)) + 4) }] : style}
      value={text}
      onChangeText={(raw) => {
        const next = sanitize(raw);
        setText(next);
        onChangeValue(parse(next));
      }}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      selectTextOnFocus
      autoFocus={autoFocus}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}

export function SetLogger({
  set,
  setIdx,
  exIdx,
  onUpdate,
  onToggleComplete,
  colors,
  styles,
  previous,
  editable = true,
  hideCompletion = false,
  nextUp = false,
  timed = false,
}: {
  set: SessionSet;
  setIdx: number;
  exIdx: number;
  onUpdate: <K extends keyof SessionSet>(exIdx: number, setIdx: number, field: K, value: SessionSet[K]) => void;
  onToggleComplete: (exIdx: number, setIdx: number) => void;
  colors: ThemeColors;
  styles: ActiveWorkoutStyles;
  previous?: SessionSet;
  editable?: boolean;
  hideCompletion?: boolean;
  /** C1 v2: the next set to do in the exercise in progress (filled "As planned"). */
  nextUp?: boolean;
  /** TIMED-SETS-M: a timed row; the count is seconds (still saved as reps_per_set). */
  timed?: boolean;
}) {
  // The count's words: "reps" as on main, "seconds" / "sec" for a timed row.
  const spoken = timed ? 'seconds' : 'reps';
  const shownUnit = timed ? ' sec' : '';
  // An explicitly typed zero is an entry, not a blank ghost to replace.
  const [weightBlank, setWeightBlank] = useState(set.weight <= 0 && !set.prescribedZero);
  const [repsBlank, setRepsBlank] = useState(set.reps <= 0);
  // C1 v2: a set that is not next is a text row until the client taps its numbers.
  const [editing, setEditing] = useState(false);
  // A 320 pt phone cannot fit the next set's fields beside its filled pill
  // (FR-917R3B renders): there the next set is its text row too (dashed, tap
  // to type) and the pill drops its tick, so the row stays on one line.
  // BEAUTY-928 (renders at 360 pt, 100% text): a timed row's "sec" makes the
  // next set's fields about 28 pt wider, so below 390 pt the filled pill
  // dropped under the numbers. A timed next set is its text row there too.
  const narrow = useWindowDimensions().width < (timed ? 390 : 360);
  // C1 v2: a set with a plan (the coach's numbers, a typed value or the last
  // workout's set) is done in one tap with "As planned"; the tap fills any
  // blank from the previous set, as the check did. Not on screens without the
  // done button (the history edit keeps main's row).
  const asPlanned = !hideCompletion && !set.completed && (!!set.prescribedZero || set.weight > 0 || set.reps > 0 || !!previous);
  const weightCell = (style: React.ComponentProps<typeof TextInput>['style'], autoFocus = false, fit?: { min: number; size: number }) => (
    <NumericCell
      fit={fit}
      autoFocus={autoFocus}
      style={style}
      value={set.weight}
      sanitize={sanitizeWeightText}
      parse={parseWeightText}
      onChangeValue={(v) => onUpdate(exIdx, setIdx, 'weight', v)}
      onBlankChange={setWeightBlank}
      placeholder={String(previous?.weight ?? 0)}
      showZero={!!set.prescribedZero || (set.completed && previous?.weight === 0)}
      keyboardType="decimal-pad"
      placeholderTextColor={sc.textMuted}
      accessibilityLabel={`Set ${setIdx + 1} weight in pounds`}
      testID={`set-weight-${exIdx}-${setIdx}`}
    />
  );
  const repsCell = (style: React.ComponentProps<typeof TextInput>['style'], fit?: { min: number; size: number }) => (
    <NumericCell
      fit={fit}
      style={style}
      value={set.reps}
      sanitize={sanitizeRepsText}
      parse={parseRepsText}
      onChangeValue={(v) => onUpdate(exIdx, setIdx, 'reps', v)}
      onBlankChange={setRepsBlank}
      placeholder={String(previous?.reps ?? 0)}
      keyboardType="number-pad"
      placeholderTextColor={sc.textMuted}
      accessibilityLabel={`Set ${setIdx + 1} ${spoken}`}
      testID={`set-reps-${exIdx}-${setIdx}`}
    />
  );
  const usePrevious = previous ? (
    <HapticPressable
      intent="light"
      disabled={set.completed || !editable}
      style={hideCompletion ? styles.previousSet : styles.previousLine}
      accessibilityRole="button"
      accessibilityLabel={`Use previous set ${setIdx + 1}: ${previous.weight} pounds, ${previous.reps} ${spoken}`}
      onPress={() => {
        onUpdate(exIdx, setIdx, 'weight', previous.weight);
        onUpdate(exIdx, setIdx, 'reps', previous.reps);
      }}
    >
      <Text style={styles.previousSetLabel}>Previous</Text>
      <Text style={styles.previousSetValue}>{previous.weight} × {previous.reps}{shownUnit}</Text>
    </HapticPressable>
  ) : null;
  // The history edit (no done button) keeps main's grid row.
  if (hideCompletion) {
    return (
      <View style={[styles.setRow, set.completed && styles.setRowCompleted]} pointerEvents={editable ? 'auto' : 'none'}>
        <Text style={[styles.setText, { width: 36 }]}>{setIdx + 1}</Text>
        {weightCell([styles.setInput, { flex: 1 }])}
        {repsCell([styles.setInput, { flex: 1 }])}
        {usePrevious ?? <View style={styles.previousSet} />}
      </View>
    );
  }
  // C1 v2 (MOCKUP3/C1/style-c-v2 C2_logger): a text row "Set 2  155 lb × 6";
  // the numbers are the fields (tap to type). The next set to do is lifted
  // (white row, forest bar) with the filled "As planned". Last time's numbers
  // stay one tap away on the next set and on a set typed away from them.
  const differs = !!previous && (previous.weight !== set.weight || previous.reps !== set.reps);
  const showPrevious = !!usePrevious && !set.completed && (nextUp || differs);
  // Only the next set (or one the client tapped) shows its fields; another
  // set is text, done in one tap or changed by tapping its numbers.
  const fields = (nextUp && !narrow) || editing;
  const zero = !!set.prescribedZero || (set.completed && previous?.weight === 0);
  const shownWeight = set.weight > 0 || zero ? set.weight : previous?.weight ?? 0;
  const shownReps = set.reps > 0 ? set.reps : previous?.reps ?? 0;
  const ghost = !(set.weight > 0 || zero) || !(set.reps > 0);
  return (
    <View style={[styles.setLine, nextUp && styles.setLineNext]} pointerEvents={editable ? 'auto' : 'none'} testID={`set-row-${exIdx}-${setIdx}`}>
      <View style={styles.setLineMain}>
        <Text style={styles.setLineLabel}>Set {setIdx + 1}</Text>
        {fields ? (
          <View style={styles.setLineValue}>
            {weightCell([styles.setLineInput, styles.setLineWeight, nextUp && styles.setLineInputNext], editing, { min: 40, size: 18 })}
            <Text style={styles.setLineUnit} accessible={false}>lb ×</Text>
            {repsCell([styles.setLineInput, styles.setLineReps, nextUp && styles.setLineInputNext], { min: 28, size: 18 })}
            {timed ? <Text style={styles.setLineUnit} accessible={false}>sec</Text> : null}
          </View>
        ) : (
          <HapticPressable intent="light" style={[styles.setLineValue, nextUp && styles.setLineInputNext]} onPress={() => setEditing(true)}
            accessibilityRole="button" accessibilityLabel={`Set ${setIdx + 1}, ${shownWeight} pounds, ${shownReps} ${spoken}. Change the numbers`}
            testID={`set-value-${exIdx}-${setIdx}`}>
            <Text style={[styles.setLineText, (ghost || (!set.completed && !nextUp)) && styles.setLineTextQuiet]}>{`${shownWeight} lb × ${shownReps}${shownUnit}`}</Text>
          </HapticPressable>
        )}
      </View>
      <HapticPressable
        intent="medium"
        style={asPlanned ? [styles.asPlannedBtn, nextUp && styles.asPlannedBtnNext]
          : [styles.checkBtn, set.completed && styles.checkBtnDone]}
        disabled={!editable}
        onPress={() => {
          // Without its fields on screen, a blank is read from the set itself.
          const blankWeight = fields ? weightBlank : set.weight <= 0 && !set.prescribedZero;
          const blankReps = fields ? repsBlank : set.reps <= 0;
          if (!set.completed && previous) {
            if (blankWeight) onUpdate(exIdx, setIdx, 'weight', previous.weight);
            if (blankReps) onUpdate(exIdx, setIdx, 'reps', previous.reps);
          }
          setEditing(false);
          onToggleComplete(exIdx, setIdx);
        }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.completed }}
        // LO-917R3 C3: the pill's words are in its name.
        accessibilityLabel={asPlanned ? `As planned, mark set ${setIdx + 1} done` : `Mark set ${setIdx + 1} done`}
        testID={`set-done-${exIdx}-${setIdx}`}
      >
        {asPlanned ? <>
          {nextUp && !narrow ? <Ionicons name="checkmark" size={16} color={sc.textOnAccent} /> : null}
          <Text style={[styles.asPlannedText, { color: nextUp ? sc.textOnAccent : sc.textMuted }]}>As planned</Text>
        </> : <Ionicons name="checkmark" size={16} color={set.completed ? colors.textOnPrimary : colors.textMuted} />}
      </HapticPressable>
      {showPrevious ? usePrevious : null}
    </View>
  );
}
