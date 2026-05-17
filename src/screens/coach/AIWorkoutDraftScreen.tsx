/**
 * AIWorkoutDraftScreen — review/edit/approve an AI-generated workout
 * program draft.
 *
 * Flow:
 *   1. GET /coach/ai/drafts/:draftId on mount
 *   2. Render the WorkoutPayload as an editable structure
 *      (weeks → days → exercises). Inline edits update local state.
 *   3. "Save edits" → POST /coach/ai/drafts/:draftId/edit { patch }
 *   4. "Approve & assign" → POST /coach/ai/drafts/:draftId/approve →
 *      navigate back to ClientDetail (workouts tab).
 *   5. "Reject" → reason modal → POST /coach/ai/drafts/:draftId/reject.
 *
 * Footer shows model + token + cost provenance for every draft so the
 * coach can see what they're paying for.
 *
 * Doctrine-clean: theme tokens, no emoji, no hex literals.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import coachAiApi from '../../api/coachAi';
import type { ClientsStackParamList } from '../../navigation/CoachNavigator';
import type {
  AiWorkoutDay,
  AiWorkoutExercise,
  AiWorkoutWeek,
  Draft,
  WorkoutPayload,
} from '../../types/coachAi';
import { errorMessage } from '../../types/common';

type Nav = NativeStackNavigationProp<ClientsStackParamList, 'AIWorkoutDraft'>;
type R = RouteProp<ClientsStackParamList, 'AIWorkoutDraft'>;

function emptyPayload(): WorkoutPayload {
  return { title: null, summary: null, weeks: [] };
}

/**
 * H1 fix: the backend WorkoutProgramPayload uses a flat `days[]` where each
 * entry carries `{ week, day, name, type, exercises }`. The mobile
 * WorkoutPayload type wraps them as `weeks[{ week, days[] }]`. This adapter
 * converts the backend shape so the draft screen can render all days across
 * all weeks without requiring a backend schema change.
 *
 * If the payload already has `weeks[]` (future-proof), it is returned as-is.
 */
function adaptPayload(raw: WorkoutPayload | Record<string, unknown>): WorkoutPayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  // Already the right shape.
  if (Array.isArray(r?.weeks) && r.weeks.length > 0) return raw as WorkoutPayload;
  // Backend flat days[] shape.
  if (Array.isArray(r?.days) && r.days.length > 0) {
    const weekMap = new Map<number, { week: number; notes?: string | null; days: AiWorkoutDay[] }>();
    for (const d of r.days) {
      const wNum: number = typeof d.week === 'number' ? d.week : 1;
      if (!weekMap.has(wNum)) weekMap.set(wNum, { week: wNum, days: [] });
      weekMap.get(wNum)!.days.push({
        day: typeof d.day === 'number' ? d.day : 1,
        focus: typeof d.name === 'string' ? d.name : null,
        exercises: Array.isArray(d.exercises)
          ? d.exercises.map((e: Record<string, unknown>) => ({
              name: typeof e.name === 'string' ? e.name : String(e.exercise_external_id ?? ''),
              sets: typeof e.sets === 'number' ? e.sets : null,
              reps: typeof e.reps_or_duration_seconds === 'number'
                ? String(e.reps_or_duration_seconds)
                : null,
              rir: null,
              rpe: null,
              notes: typeof e.notes === 'string' ? e.notes : null,
            }))
          : [],
      });
    }
    const weeks = Array.from(weekMap.values()).sort((a, b) => a.week - b.week);
    return {
      title: typeof r.summary === 'string' ? r.summary.slice(0, 60) : null,
      summary: typeof r.summary === 'string' ? r.summary : null,
      weeks,
    };
  }
  return raw as WorkoutPayload;
}

export default function AIWorkoutDraftScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { draftId, clientId, clientName } = route.params;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft<WorkoutPayload> | null>(null);
  const [payload, setPayload] = useState<WorkoutPayload>(emptyPayload());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await coachAiApi.getDraft<WorkoutPayload>(draftId);
      setDraft(res.data);
      // H1 fix: adapt the backend flat-days[] shape to the mobile weeks[]
      // shape so all days across all weeks are visible in the draft screen.
      setPayload(adaptPayload(res.data.generatedPayload || emptyPayload()));
      setDirty(false);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load draft.'));
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateWeek = (wIdx: number, patch: Partial<AiWorkoutWeek>) => {
    setPayload((prev) => ({
      ...prev,
      weeks: prev.weeks.map((w, i) => (i === wIdx ? { ...w, ...patch } : w)),
    }));
    setDirty(true);
  };

  const updateDay = (wIdx: number, dIdx: number, patch: Partial<AiWorkoutDay>) => {
    setPayload((prev) => ({
      ...prev,
      weeks: prev.weeks.map((w, i) =>
        i === wIdx
          ? {
              ...w,
              days: w.days.map((d, j) => (j === dIdx ? { ...d, ...patch } : d)),
            }
          : w,
      ),
    }));
    setDirty(true);
  };

  const updateExercise = (
    wIdx: number,
    dIdx: number,
    eIdx: number,
    patch: Partial<AiWorkoutExercise>,
  ) => {
    setPayload((prev) => ({
      ...prev,
      weeks: prev.weeks.map((w, i) =>
        i === wIdx
          ? {
              ...w,
              days: w.days.map((d, j) =>
                j === dIdx
                  ? {
                      ...d,
                      exercises: d.exercises.map((e, k) =>
                        k === eIdx ? { ...e, ...patch } : e,
                      ),
                    }
                  : d,
              ),
            }
          : w,
      ),
    }));
    setDirty(true);
  };

  // C-2: handleSave returns a boolean so the "Save and approve" path can
  // gate `performApprove()` on the save actually succeeding. Without
  // this, a coach who hits "Save and approve" while the server save
  // fails sees "Save failed" immediately followed by "Approved" — and
  // the pre-edit server draft is what gets assigned. Surfaces look
  // green; the wrong plan ships.
  const handleSave = async (): Promise<boolean> => {
    if (!draft) return false;
    setSaving(true);
    try {
      await coachAiApi.editDraft<WorkoutPayload>(draft.draftId, payload);
      setDirty(false);
      Alert.alert('Saved', 'Edits saved to the draft.');
      return true;
    } catch (err) {
      Alert.alert('Save failed', errorMessage(err, 'Try again.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!draft) return;
    if (dirty) {
      Alert.alert(
        'Save edits first?',
        'You have unsaved changes. Save before approving?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard and approve',
            style: 'destructive',
            onPress: () => performApprove(),
          },
          {
            text: 'Save and approve',
            onPress: async () => {
              const ok = await handleSave();
              if (ok) performApprove();
              // else: stay on the screen with the edits in place; the
              // 'Save failed' alert from handleSave is already on screen.
            },
          },
        ],
      );
      return;
    }
    performApprove();
  };

  const performApprove = async () => {
    if (!draft) return;
    setApproving(true);
    try {
      await coachAiApi.approveDraft(draft.draftId);
      Alert.alert(
        'Approved',
        `Workout program assigned to ${clientName}.`,
        [
          {
            text: 'OK',
            onPress: () =>
              navigation.navigate('ClientDetail', { clientId, clientName }),
          },
        ],
      );
    } catch (err) {
      Alert.alert('Approve failed', errorMessage(err, 'Try again.'));
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!draft) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Alert.alert('Reason required', 'Tell the system why this draft was rejected.');
      return;
    }
    setRejecting(true);
    try {
      await coachAiApi.rejectDraft(draft.draftId, reason);
      setShowRejectModal(false);
      Alert.alert('Rejected', 'Draft rejected.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Reject failed', errorMessage(err, 'Try again.'));
    } finally {
      setRejecting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (loadError || !draft) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
        <Text style={styles.errorText}>{loadError || 'Draft not available.'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load} accessibilityRole="button">
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const weeks = payload.weeks || [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {payload.title || 'Workout draft'}
          </Text>
          <Text style={styles.headerSubtitle}>For {clientName}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {payload.summary ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryText}>{payload.summary}</Text>
          </View>
        ) : null}

        {weeks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="barbell-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              No structured weeks returned by the model.
            </Text>
          </View>
        ) : (
          weeks.map((week, wIdx) => (
            <View key={`w-${wIdx}`} style={styles.weekCard}>
              <Text style={styles.weekTitle}>Week {week.week ?? wIdx + 1}</Text>
              <TextInput
                style={styles.weekNotesInput}
                placeholder="Week notes (optional)"
                placeholderTextColor={colors.textMuted}
                value={week.notes || ''}
                onChangeText={(t) => updateWeek(wIdx, { notes: t })}
                multiline
                accessibilityLabel={`Week ${wIdx + 1} notes`}
              />
              {(week.days || []).map((day, dIdx) => (
                <View key={`d-${dIdx}`} style={styles.dayCard}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayTitle}>Day {day.day ?? dIdx + 1}</Text>
                    <TextInput
                      style={styles.focusInput}
                      placeholder="Focus"
                      placeholderTextColor={colors.textMuted}
                      value={day.focus || ''}
                      onChangeText={(t) => updateDay(wIdx, dIdx, { focus: t })}
                      accessibilityLabel={`Day ${dIdx + 1} focus`}
                    />
                  </View>
                  {(day.exercises || []).map((ex, eIdx) => (
                    <View key={`e-${eIdx}`} style={styles.exerciseRow}>
                      <TextInput
                        style={[styles.exerciseInput, styles.exerciseName]}
                        value={ex.name || ''}
                        onChangeText={(t) =>
                          updateExercise(wIdx, dIdx, eIdx, { name: t })
                        }
                        placeholder="Exercise"
                        placeholderTextColor={colors.textMuted}
                        accessibilityLabel={`Exercise ${eIdx + 1} name`}
                      />
                      <View style={styles.exerciseRowBottom}>
                        <NumericField
                          label="Sets"
                          value={ex.sets}
                          onChange={(n) =>
                            updateExercise(wIdx, dIdx, eIdx, { sets: n })
                          }
                          testID={`workout-sets-${wIdx}-${dIdx}-${eIdx}`}
                        />
                        <StringField
                          label="Reps"
                          value={ex.reps == null ? '' : String(ex.reps)}
                          onChange={(s) =>
                            updateExercise(wIdx, dIdx, eIdx, { reps: s })
                          }
                          testID={`workout-reps-${wIdx}-${dIdx}-${eIdx}`}
                        />
                        <NumericField
                          label="RIR"
                          value={ex.rir}
                          onChange={(n) =>
                            updateExercise(wIdx, dIdx, eIdx, { rir: n })
                          }
                        />
                        <NumericField
                          label="RPE"
                          value={ex.rpe}
                          onChange={(n) =>
                            updateExercise(wIdx, dIdx, eIdx, { rpe: n })
                          }
                        />
                      </View>
                      <TextInput
                        style={[styles.exerciseInput, styles.exerciseNotes]}
                        value={ex.notes || ''}
                        onChangeText={(t) =>
                          updateExercise(wIdx, dIdx, eIdx, { notes: t })
                        }
                        placeholder="Notes (optional)"
                        placeholderTextColor={colors.textMuted}
                        multiline
                        accessibilityLabel={`Exercise ${eIdx + 1} notes`}
                      />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* Footer — provenance + actions */}
      <View style={styles.footer}>
        <Text style={styles.provenance}>
          {`Model used: ${draft.modelUsed} · ${draft.tokensIn}+${draft.tokensOut} tokens · $${(
            draft.costCents / 100
          ).toFixed(2)}`}
        </Text>
        <View style={styles.footerBtns}>
          <TouchableOpacity
            style={[styles.btnSecondary, !dirty && { opacity: 0.5 }]}
            onPress={() => {
              void handleSave();
            }}
            disabled={!dirty || saving}
            accessibilityRole="button"
            accessibilityLabel="Save edits"
          >
            <Text style={styles.btnSecondaryText}>
              {saving ? 'Saving…' : 'Save edits'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnReject}
            onPress={() => {
              setRejectReason('');
              setShowRejectModal(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Reject draft"
          >
            <Text style={styles.btnRejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnApprove, approving && { opacity: 0.6 }]}
            onPress={handleApprove}
            disabled={approving}
            accessibilityRole="button"
            accessibilityLabel="Approve and assign"
          >
            <Text style={styles.btnApproveText}>
              {approving ? 'Approving…' : 'Approve & assign'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.rejectOverlay}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Reject draft</Text>
            <Text style={styles.rejectDesc}>
              Tell the system what was wrong so we can improve.
            </Text>
            <TextInput
              style={styles.rejectInput}
              placeholder="e.g. Too volume-heavy for a beginner."
              placeholderTextColor={colors.textMuted}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              maxLength={500}
              accessibilityLabel="Rejection reason"
            />
            <View style={styles.rejectBtns}>
              <TouchableOpacity
                style={styles.rejectCancelBtn}
                onPress={() => setShowRejectModal(false)}
              >
                <Text style={styles.rejectCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rejectConfirmBtn, rejecting && { opacity: 0.6 }]}
                onPress={handleReject}
                disabled={rejecting}
              >
                <Text style={styles.rejectConfirmText}>
                  {rejecting ? 'Sending…' : 'Reject'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Numeric/string sub-fields ───────────────────────────────────────────────

function NumericField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.numField}>
      <Text style={styles.numFieldLabel}>{label}</Text>
      <TextInput
        style={styles.numFieldInput}
        keyboardType="numeric"
        value={value == null ? '' : String(value)}
        onChangeText={(t) => {
          if (t === '') return onChange(null);
          const n = Number(t);
          onChange(Number.isFinite(n) ? n : null);
        }}
        placeholderTextColor={colors.textMuted}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );
}

function StringField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.numField}>
      <Text style={styles.numFieldLabel}>{label}</Text>
      <TextInput
        style={styles.numFieldInput}
        value={value}
        onChangeText={onChange}
        placeholderTextColor={colors.textMuted}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 24,
      gap: 12,
    },
    errorText: { color: colors.textSecondary, textAlign: 'center' },
    retryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 4,
    },
    retryBtnText: {
      fontFamily: 'Inter_500Medium',
      color: colors.textOnPrimary,
      fontWeight: '600',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    headerSubtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    scrollContent: { padding: 20, paddingBottom: 40 },
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      marginBottom: 16,
    },
    summaryText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 32,
      alignItems: 'center',
      gap: 8,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: 'center',
    },
    weekCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    weekTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    weekNotesInput: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 8,
      fontSize: 13,
      color: colors.textPrimary,
      marginBottom: 10,
      minHeight: 36,
    },
    dayCard: {
      backgroundColor: colors.background,
      borderRadius: 4,
      padding: 10,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    dayTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    focusInput: {
      flex: 1,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingVertical: 4,
      fontSize: 13,
      color: colors.textSecondary,
    },
    exerciseRow: {
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    exerciseInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      padding: 8,
      fontSize: 13,
      color: colors.textPrimary,
      marginBottom: 6,
    },
    exerciseName: { fontWeight: '600' },
    exerciseNotes: { minHeight: 36, textAlignVertical: 'top' },
    exerciseRowBottom: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 6,
    },
    numField: { flex: 1 },
    numFieldLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 10,
      fontWeight: '500',
      color: colors.textMuted,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    numFieldInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 4,
      paddingVertical: 6,
      paddingHorizontal: 8,
      fontSize: 13,
      color: colors.textPrimary,
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 20,
      gap: 10,
    },
    provenance: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: colors.textMuted,
      textAlign: 'center',
    },
    footerBtns: {
      flexDirection: 'row',
      gap: 8,
    },
    btnSecondary: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
    },
    btnSecondaryText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textPrimary,
    },
    btnReject: {
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.error,
      alignItems: 'center',
    },
    btnRejectText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.error,
    },
    btnApprove: {
      flex: 1.5,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    btnApproveText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
    rejectOverlay: {
      flex: 1,
      backgroundColor: 'rgba(26,26,24,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    rejectCard: {
      width: '85%',
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 20,
    },
    rejectTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      fontWeight: '500',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    rejectDesc: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    rejectInput: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: 4,
      padding: 10,
      fontSize: 14,
      color: colors.textPrimary,
      minHeight: 80,
      textAlignVertical: 'top',
      marginBottom: 12,
    },
    rejectBtns: {
      flexDirection: 'row',
      gap: 10,
    },
    rejectCancelBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
    },
    rejectCancelText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    rejectConfirmBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 4,
      backgroundColor: colors.error,
      alignItems: 'center',
    },
    rejectConfirmText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textOnPrimary,
    },
  });
