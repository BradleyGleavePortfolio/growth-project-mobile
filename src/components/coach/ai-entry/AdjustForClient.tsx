/** AIB-FINISH-127 job 6 "Template to client": pick a saved workout, make the client's own copy (the builder's create + exercises calls;
 * the saved workout never changes), open it with Ask AI and the client's context. The client gets it only when the coach assigns it.
 * Shown where Ask AI exists (status route present) in builds with the builder's autosave, the same rule as the library entry. */
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeProvider';
import { spacing, typography } from '../../../theme/tokens';
import { featureFlags } from '../../../config/featureFlags';
import { useSavedWorkouts } from '../../../hooks/usePrograms';
import { workoutBuilderApi } from '../../../api/workoutBuilderApi';
import type { SavedWorkout } from '../../../api/programsApi';
import { useAiEntryStatus } from './useAiEntryStatus';
import { fireAiHaptic } from '../ai-builder/useAiBuilder';

export const ADJUST_COPY = {
  failed: 'The copy was not made. The saved workout is unchanged. Check your connection and try again.',
  loadFailed: 'Saved workouts did not load. Check your connection and try again.',
} as const;

/** The client's copy, by value: same details and rows, named for the client. Returns the new plan id. */
export async function copyWorkoutForClient(sourcePlanId: string, firstName: string): Promise<string> {
  const src = (await workoutBuilderApi.getPlan(sourcePlanId)).data;
  const created = (await workoutBuilderApi.createPlan({
    name: `${src.name} for ${firstName}`.slice(0, 120), type: src.type, duration_estimate_minutes: src.duration_estimate_minutes ?? undefined,
  })).data;
  const rows = [...src.exercises].sort((a, b) => a.order - b.order).map((e, i) => ({
    exercise_external_id: e.exercise_external_id, order: i + 1, sets: e.sets, reps_or_duration_seconds: e.reps_or_duration_seconds,
    weight_lbs: e.weight_lbs ?? undefined, rest_seconds: e.rest_seconds ?? undefined, superset_group_id: e.superset_group_id ?? undefined, notes: e.notes ?? undefined,
  }));
  await workoutBuilderApi.setExercises(created.id, rows);
  return created.id;
}

function PickSheet({ firstName, onClose, onOpened }: { firstName: string; onClose: () => void; onOpened: (planId: string) => void }) {
  const { semanticColors: sc } = useTheme();
  const saved = useSavedWorkouts('');
  const items: SavedWorkout[] = saved.data?.pages.flatMap((p) => p.items) ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async (w: SavedWorkout) => {
    if (busyId) return;
    fireAiHaptic('light');
    setBusyId(w.id);
    setError(null);
    try {
      const planId = await copyWorkoutForClient(w.id, firstName);
      onOpened(planId);
    } catch {
      fireAiHaptic('error');
      setError(ADJUST_COPY.failed);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: sc.overlay }]}>
        <View testID="adjust-for-client-sheet" style={[styles.sheet, { backgroundColor: sc.bgPrimary, borderColor: sc.border }]}>
          <View style={styles.row}>
            <Text accessibilityRole="header" style={[typography.h4, styles.grow, { color: sc.textPrimary }]}>{`Adjust a workout for ${firstName}`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
              <Text style={[typography.bodyMd, { color: sc.accentText }]}>Close</Text>
            </Pressable>
          </View>
          <Text style={[typography.caption, { color: sc.textMuted, marginBottom: spacing.sm }]}>
            {`Pick a saved workout. ${firstName} gets a copy to adjust with Ask AI; the saved workout stays as it is.`}
          </Text>
          {error ? <Text testID="adjust-for-client-error" accessibilityRole="alert" style={[typography.body, { color: sc.textPrimary }]}>{error}</Text> : null}
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {saved.isLoading ? <ActivityIndicator color={sc.accentText} accessibilityLabel="Loading saved workouts" /> : null}
            {saved.error ? <Text style={[typography.body, { color: sc.textPrimary }]}>{ADJUST_COPY.loadFailed}</Text> : null}
            {!saved.isLoading && !saved.error && items.length === 0 ? (
              <Text style={[typography.body, { color: sc.textMuted }]}>No saved workouts yet. Build one in Programs, then adjust it here.</Text>
            ) : null}
            {items.map((w) => (
              <Pressable key={w.id} testID={`adjust-for-client-${w.id}`} accessibilityRole="button" accessibilityLabel={`Adjust ${w.name} for ${firstName}`}
                accessibilityState={{ disabled: !!busyId, busy: busyId === w.id }} disabled={!!busyId} onPress={() => void pick(w)}
                style={[styles.item, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}>
                <Text style={[typography.bodyMd, styles.grow, { color: sc.textPrimary }]} numberOfLines={2}>{w.name}</Text>
                <Text style={[typography.caption, { color: sc.textMuted }]}>{busyId === w.id ? 'Copying' : `${w.exercise_count} exercises`}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type EntryProps = { firstName: string; onOpened: (planId: string) => void };
/** The Workouts tab entry: "Adjust a saved workout for <first name>". Flag off: no status request at all. */
export const AdjustForClientEntry = (props: EntryProps) => (featureFlags.mwbAutosave ? <Entry {...props} /> : null);
function Entry({ firstName, onOpened }: EntryProps) {
  const { semanticColors: sc } = useTheme();
  const ai = useAiEntryStatus();
  const [open, setOpen] = useState(false);
  if (!ai.visible) return null;
  return (
    <>
      <Pressable testID="workouts-adjust-with-ai" accessibilityRole="button" accessibilityLabel={`Adjust a saved workout for ${firstName}`}
        accessibilityHint="Copies the workout for this client and opens Ask AI. Nothing reaches the client until you assign it."
        onPress={() => { fireAiHaptic('light'); setOpen(true); }} style={[styles.entry, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}>
        <Ionicons name="sparkles-outline" size={20} color={sc.accentText} />
        <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>{`Adjust a saved workout for ${firstName}`}</Text>
      </Pressable>
      {open ? <PickSheet firstName={firstName} onClose={() => setOpen(false)} onOpened={(id) => { setOpen(false); onOpened(id); }} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%', minHeight: '45%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  grow: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  entry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: 12 },
});
