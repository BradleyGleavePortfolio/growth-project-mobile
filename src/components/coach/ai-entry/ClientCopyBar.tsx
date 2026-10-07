/** AIB-FINISH-127 job 6: the builder on a client's copy. The copy reaches the client only when assigned here; the assignment freezes
 * the rows at that moment (backend writeAssignmentSnapshot), so it comes after Ask AI, and the last edit is saved first. */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { spacing, typography } from '../../../theme/tokens';
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
    fireAiHaptic('medium');
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
    <View testID="client-copy-bar" style={[styles.bar, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}>
      <Text style={[typography.caption, { color: sc.textMuted }]}>{copy.intro}</Text>
      <Pressable testID="client-copy-assign" accessibilityRole="button" accessibilityLabel={copy.assign}
        accessibilityState={{ disabled: busy || done, busy }} disabled={busy || done} onPress={() => void onAssign()}
        style={[styles.button, { backgroundColor: busy || done ? sc.disabledBg : sc.accent }]}>
        <Text style={[typography.bodyMd, { color: busy || done ? sc.textOnDisabled : sc.textOnAccent }]}>
          {done ? 'Assigned' : busy ? 'Assigning' : copy.assign}
        </Text>
      </Pressable>
      {note ? <Text testID="client-copy-note" accessibilityLiveRegion="polite" style={[typography.body, { color: sc.textPrimary }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderWidth: 1, borderRadius: 12, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  button: { alignItems: 'center', borderRadius: 10, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
});
