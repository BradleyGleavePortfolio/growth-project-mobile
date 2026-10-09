/** AIB-FINISH-127 job 6: the builder on a client's copy. The copy reaches the client only when assigned here; the assignment freezes
 * the rows at that moment (backend writeAssignmentSnapshot), so it comes after Ask AI, and the last edit is saved first. */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import HapticPressable from '../../HapticPressable';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, spacing, typography } from '../../../theme/tokens';
import { useAssignWorkoutPlan } from '../../../hooks/useWorkoutBuilder';
import { fireAiHaptic } from '../ai-builder/useAiBuilder';

export const clientCopyCopy = (first: string) => ({
  intro: `${first}'s copy. Ask AI fits it to ${first}'s consultation answers. ${first} gets it when you assign it.`,
  assign: `Assign to ${first} for today`,
  assigned: `Assigned to ${first} for today.`,
  saving: 'Your last edit is still saving. Assign again in a moment.',
  failed: `The workout was not assigned to ${first}. Check your connection and try again.`,
});

export function ClientCopyBar({ planId, clientId, firstName, prepare }: {
  planId: string; clientId: string; firstName: string; prepare: () => Promise<{ ok: boolean }>;
}) {
  const { semanticColors: sc } = useTheme();
  const assign = useAssignWorkoutPlan();
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const copy = clientCopyCopy(firstName);
  const busy = assign.isPending;
  const onAssign = async () => {
    if (busy || done) return;
    setNote(null);
    if (!(await prepare()).ok) return setNote(copy.saving);
    try {
      await assign.mutateAsync({ planId, input: { client_id: clientId, scheduled_for: new Date().toISOString() } });
      fireAiHaptic('success');
      setDone(true);
      setNote(copy.assigned);
    } catch {
      fireAiHaptic('error');
      setNote(copy.failed);
    }
  };
  return (
    <View testID="client-copy-bar" style={[styles.bar, { borderColor: sc.border }]}>
      <Text style={[typography.caption, { color: sc.textMuted }]}>{copy.intro}</Text>
      {/* REDO-COACH-133: an outlined forest action; the builder's Save is the
          screen's one filled button. The press haptic comes from HapticPressable. */}
      <HapticPressable intent="medium" testID="client-copy-assign" accessibilityRole="button" accessibilityLabel={copy.assign}
        accessibilityState={{ disabled: busy || done, busy }} disabled={busy || done} onPress={() => void onAssign()}
        style={[styles.button, { borderColor: busy || done ? sc.border : sc.accentText }]}>
        <Text style={[typography.bodyMd, { color: busy || done ? sc.textMuted : sc.accentText }]}>
          {done ? 'Assigned' : busy ? 'Assigning' : copy.assign}
        </Text>
      </HapticPressable>
      {note ? <Text testID="client-copy-note" accessibilityLiveRegion="polite" style={[typography.body, { color: sc.textPrimary }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  button: { alignItems: 'center', borderWidth: 1, borderRadius: radius.button, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
});
