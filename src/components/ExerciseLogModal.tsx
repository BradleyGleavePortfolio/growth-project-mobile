import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { colors } from '../theme';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExerciseLogSet {
  setNumber: number;
  weight: number;
  reps: number;
  volume: number;
}

export interface ExerciseLogSaveData {
  exerciseId: string;
  exerciseName: string;
  muscle: string;
  sets: ExerciseLogSet[];
  totalVolume: number;
}

export interface ExerciseLogModalProps {
  visible: boolean;
  exercise: { id: string; name: string; muscle: string; equipment: string } | null;
  onSave: (data: ExerciseLogSaveData) => void;
  onClose: () => void;
}

// ── Internal set state (string inputs for controlled TextInput) ────────────

interface SetRow {
  weightStr: string;
  repsStr: string;
}

const DEFAULT_SET: SetRow = { weightStr: '', repsStr: '' };

function makeDefaultSets(n: number): SetRow[] {
  return Array.from({ length: n }, () => ({ ...DEFAULT_SET }));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseWeight(s: string): number {
  const v = parseFloat(s);
  return isNaN(v) || v < 0 ? 0 : v;
}

function parseReps(s: string): number {
  const v = parseInt(s, 10);
  return isNaN(v) || v < 0 ? 0 : v;
}

function calcVolume(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  return weight * reps; // weight=0 → 0 (bodyweight)
}

function formatVolumeDisplay(v: number): string {
  return v.toLocaleString('en-US');
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ExerciseLogModal({
  visible,
  exercise,
  onSave,
  onClose,
}: ExerciseLogModalProps) {
  const [sets, setSets] = useState<SetRow[]>(makeDefaultSets(3));
  const [error, setError] = useState<string | null>(null);

  // Refs for auto-advancing focus: [weight0, reps0, weight1, reps1, ...]
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Reset state each time the modal opens for a new exercise
  useEffect(() => {
    if (visible) {
      setSets(makeDefaultSets(3));
      setError(null);
      inputRefs.current = [];
    }
  }, [visible, exercise?.id]);

  // Computed totals
  const parsedSets = sets.map((s) => ({
    weight: parseWeight(s.weightStr),
    reps: parseReps(s.repsStr),
  }));

  const totalVolume = parsedSets.reduce(
    (sum, s) => sum + calcVolume(s.weight, s.reps),
    0
  );

  // ── Set management ───────────────────────────────────────────────────────

  const handleAddSet = useCallback(() => {
    setSets((prev) => [...prev, { ...DEFAULT_SET }]);
  }, []);

  const handleRemoveSet = useCallback(() => {
    setSets((prev) => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const handleDuplicateLastSet = useCallback(() => {
    setSets((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      return [...prev, { weightStr: last.weightStr, repsStr: last.repsStr }];
    });
  }, []);

  const updateSet = useCallback((idx: number, field: keyof SetRow, value: string) => {
    // Validate: only digits and one optional decimal point (for weight)
    if (field === 'weightStr') {
      if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
    } else {
      if (value !== '' && !/^\d*$/.test(value)) return;
    }
    setError(null);
    setSets((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  }, []);

  // Auto-advance: weight → reps → next weight → ...
  const handleWeightSubmit = useCallback((idx: number) => {
    const repsRef = inputRefs.current[idx * 2 + 1];
    if (repsRef) repsRef.focus();
  }, []);

  const handleRepsSubmit = useCallback(
    (idx: number) => {
      const nextWeightRef = inputRefs.current[(idx + 1) * 2];
      if (nextWeightRef) {
        nextWeightRef.focus();
      }
    },
    []
  );

  // ── Validation & Save ────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!exercise) return;

    // Validate: at least one set with reps > 0
    const hasValidSet = parsedSets.some((s) => s.reps > 0);
    if (!hasValidSet) {
      setError('Enter at least one set with reps > 0.');
      return;
    }

    // Filter out sets with reps=0 (incomplete rows)
    const validSets = parsedSets
      .filter((s) => s.reps > 0)
      .map((s, i) => ({
        setNumber: i + 1,
        weight: s.weight,
        reps: s.reps,
        volume: calcVolume(s.weight, s.reps),
      }));

    const total = validSets.reduce((sum, s) => sum + s.volume, 0);

    onSave({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      muscle: exercise.muscle,
      sets: validSets,
      totalVolume: total,
    });
  }, [exercise, parsedSets, onSave]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (!exercise) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {exercise.name}
              </Text>
              <Text style={styles.headerMeta}>
                {exercise.muscle.charAt(0).toUpperCase() + exercise.muscle.slice(1)} · {exercise.equipment}
              </Text>
            </View>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Column headers */}
            <View style={styles.colHeaders}>
              <Text style={[styles.colHeader, styles.colSet]}>Set</Text>
              <Text style={[styles.colHeader, styles.colWeight]}>Weight (lbs)</Text>
              <Text style={styles.colMultiply}> </Text>
              <Text style={[styles.colHeader, styles.colReps]}>Reps</Text>
              <Text style={[styles.colHeader, styles.colVol]}>Volume</Text>
            </View>

            {/* Set rows */}
            {sets.map((set, idx) => {
              const w = parseWeight(set.weightStr);
              const r = parseReps(set.repsStr);
              const vol = calcVolume(w, r);
              return (
                <View key={idx} style={styles.setRow}>
                  {/* Set number */}
                  <View style={[styles.setNumCell, styles.colSet]}>
                    <Text style={styles.setNum}>{idx + 1}</Text>
                  </View>

                  {/* Weight input */}
                  <TextInput
                    ref={(ref) => { inputRefs.current[idx * 2] = ref; }}
                    style={[styles.input, styles.colWeight]}
                    value={set.weightStr}
                    onChangeText={(v) => updateSet(idx, 'weightStr', v)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    returnKeyType="next"
                    onSubmitEditing={() => handleWeightSubmit(idx)}
                    blurOnSubmit={false}
                    selectTextOnFocus
                  />

                  {/* × separator */}
                  <Text style={styles.colMultiply}>×</Text>

                  {/* Reps input */}
                  <TextInput
                    ref={(ref) => { inputRefs.current[idx * 2 + 1] = ref; }}
                    style={[styles.input, styles.colReps]}
                    value={set.repsStr}
                    onChangeText={(v) => updateSet(idx, 'repsStr', v)}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    returnKeyType={idx < sets.length - 1 ? 'next' : 'done'}
                    onSubmitEditing={() => handleRepsSubmit(idx)}
                    blurOnSubmit={idx === sets.length - 1}
                    selectTextOnFocus
                  />

                  {/* = Volume */}
                  <View style={[styles.volCell, styles.colVol]}>
                    <Text style={styles.volText}>
                      {vol > 0 ? formatVolumeDisplay(vol) : '–'}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* Set controls */}
            <View style={styles.setControls}>
              <TouchableOpacity style={styles.setControlBtn} onPress={handleAddSet}>
                <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                <Text style={styles.setControlText}>Add Set</Text>
              </TouchableOpacity>

              {sets.length > 1 && (
                <TouchableOpacity style={styles.setControlBtn} onPress={handleRemoveSet}>
                  <Ionicons name="remove-circle-outline" size={18} color={Colors.error} />
                  <Text style={[styles.setControlText, { color: Colors.error }]}>Remove Last</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.setControlBtn} onPress={handleDuplicateLastSet}>
                <Ionicons name="copy-outline" size={18} color={Colors.accent} />
                <Text style={[styles.setControlText, { color: Colors.accent }]}>Duplicate Previous</Text>
              </TouchableOpacity>
            </View>

            {/* Error */}
            {error && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Total volume */}
            <View style={styles.totalVolCard}>
              <Ionicons name="barbell-outline" size={20} color={Colors.primary} />
              <Text style={styles.totalVolLabel}>Total Volume:</Text>
              <Text style={styles.totalVolValue}>
                {formatVolumeDisplay(totalVolume)} lbs
              </Text>
            </View>
          </ScrollView>

          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.textOnPrimary} />
              <Text style={styles.saveBtnText}>Save Exercise</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  headerMeta: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },

  // Column headers
  colHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  colHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
  },
  colSet: { width: 32 },
  colWeight: { flex: 2, textAlign: 'center' },
  colMultiply: {
    width: 16,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
  },
  colReps: { flex: 1.5, textAlign: 'center' },
  colVol: { flex: 2, textAlign: 'right' },

  // Set rows
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  setNumCell: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
  },
  setNum: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.primary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4, // radius.lg
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
    height: 44,
  },
  volCell: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    height: 44,
  },
  volText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  // Set controls
  setControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  setControlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  setControlText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },

  // Error
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    backgroundColor: colors.feedback.errorBg,
    borderRadius: 0, // radius.sm
    padding: 10,
  },
  errorText: {
    fontSize: 13,
    color: Colors.error,
    fontWeight: '600',
  },

  // Total volume card
  totalVolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryPale,
    borderRadius: 2, // radius.md
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  totalVolLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
    flex: 1,
  },
  totalVolValue: {
    fontSize: 20,
    fontWeight: '500',
    color: Colors.primary,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '500',
    color: Colors.textOnPrimary,
  },
});
