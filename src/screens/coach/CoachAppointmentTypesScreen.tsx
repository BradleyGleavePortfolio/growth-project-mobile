/**
 * CoachAppointmentTypesScreen — S-SCHED appointment types manager.
 *
 * Create, edit and archive the appointment types clients book from: name,
 * description, length and confirmed right away (auto-approve), using the
 * existing DTO. Types archived during this visit can be restored before
 * leaving. A separate backend contract is needed to list archive history.
 */
import React, { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import type { SessionType } from '../../api/schedulingApi';
import { useBookableTypes } from '../../hooks/useCalendar';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import { useCreateSessionType, useUpdateSessionType } from '../../hooks/useScheduling';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

type Params = { CoachAppointmentTypes: { coachId?: string } | undefined };

const DURATIONS = [15, 20, 30, 45, 60];

export interface TypeDraft {
  name: string;
  description: string;
  duration: string;
  autoApprove: boolean;
}

export function emptyDraft(): TypeDraft {
  return { name: '', description: '', duration: '30', autoApprove: false };
}

export function draftFrom(t: SessionType): TypeDraft {
  return {
    name: t.name,
    description: t.description ?? '',
    duration: String(t.duration_minutes),
    autoApprove: t.auto_approve,
  };
}

/** Returns an error message, or null when the draft can be saved. */
export function validateDraft(d: TypeDraft): string | null {
  if (d.name.trim().length === 0) return 'Give the appointment type a name.';
  if (d.name.trim().length > 120) return 'Keep the name under 120 characters.';
  const n = Number(d.duration);
  if (!Number.isInteger(n) || n < 5 || n > 480) return 'Length must be between 5 and 480 minutes.';
  if (d.description.length > 2000) return 'Keep the description under 2000 characters.';
  return null;
}

export default function CoachAppointmentTypesScreen({ route }: { route?: RouteProp<Params, 'CoachAppointmentTypes'> }) {
  const { colors } = useTheme();
  const me = useCurrentUser();
  const coachId = route?.params?.coachId ?? me?.id;
  const q = useBookableTypes(coachId);
  const create = useCreateSessionType();
  const update = useUpdateSessionType();
  const [editing, setEditing] = useState<SessionType | 'new' | null>(null);
  const [draft, setDraft] = useState<TypeDraft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  // Existing server lists active types only. Keep rows archived during this
  // visit visible so a coach can undo; do not pretend to list all history.
  const [archivedHere, setArchivedHere] = useState<SessionType[]>([]);
  const saving = useRef(false);

  const open = (t: SessionType | 'new') => {
    setEditing(t);
    setDraft(t === 'new' ? emptyDraft() : draftFrom(t));
    setError(null);
  };

  const save = () => {
    if (saving.current || !editing) return;
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    saving.current = true;
    const common = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      duration_minutes: Number(draft.duration),
      auto_approve: draft.autoApprove,
    };
    const done = {
      onSuccess: () => setEditing(null),
      onError: (err: unknown) => setError(calendarErrorMessage(err, 'save the appointment type')),
      onSettled: () => {
        saving.current = false;
      },
    };
    if (editing === 'new') {
      create.mutate(
        { ...common, default_video_provider: 'manual' },
        done,
      );
    } else {
      update.mutate({ id: editing.id, input: common }, done);
    }
  };

  const setArchived = (t: SessionType, archived: boolean) => {
    if (saving.current || busy) return;
    saving.current = true;
    setError(null);
    update.mutate({ id: t.id, input: { archived } }, {
      onSuccess: (saved) => {
        setArchivedHere((rows) => [
          ...rows.filter((row) => row.id !== saved.id),
          ...(archived ? [saved] : []),
        ]);
      },
      onError: (err: unknown) => setError(calendarErrorMessage(err, archived ? 'archive the appointment type' : 'restore the appointment type')),
      onSettled: () => { saving.current = false; },
    });
  };

  const archivedIds = new Set(archivedHere.map((row) => row.id));
  const rows = [...(q.data ?? []).filter((row) => !row.archived_at && !archivedIds.has(row.id)), ...archivedHere];
  const busy = create.isPending || update.isPending;

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container} testID="coach-types">
      <Text style={[typography.h2, { color: colors.textPrimary }]} accessibilityRole="header">
        Appointment types
      </Text>
      <Text style={[typography.bodySmall, { color: colors.textMuted, marginTop: spacing.sm }]}>
        Clients book from these in their Calendar, inside your availability and time off.
      </Text>
      <Pressable
        onPress={() => open('new')}
        accessibilityRole="button"
        accessibilityLabel="Add appointment type"
        style={[styles.primary, { backgroundColor: colors.textPrimary }]}
        testID="coach-types-add"
      >
        <Text style={[typography.bodyMd, { color: colors.background }]}>Add appointment type</Text>
      </Pressable>
      {q.isLoading ? <Text style={[typography.body, { color: colors.textMuted }]}>Loading.</Text> : null}
      {q.isError ? (
        <View>
          <Text style={[typography.body, { color: colors.textMuted }]}>{calendarErrorMessage(q.error, 'load appointment types')}</Text>
          <Pressable onPress={() => void q.refetch()} accessibilityRole="button" accessibilityLabel="Refresh appointment types" style={[styles.primary, { borderColor: colors.border, borderWidth: 1 }]}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>Refresh appointment types</Text>
          </Pressable>
        </View>
      ) : null}
      {!q.isLoading && !q.isError && rows.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.lg }]} testID="coach-types-empty">
          No appointment types yet. Clients cannot book until you add one.
        </Text>
      ) : null}
      {rows.map((t) => (
        <View key={t.id} style={[styles.card, { borderColor: colors.border, opacity: t.archived_at ? 0.6 : 1 }]} testID={`coach-type-${t.id}`}>
          <Text style={[typography.bodyMd, { color: colors.textPrimary }]}>
            {t.name}
            {t.archived_at ? ' (archived)' : ''}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textMuted }]}>
            {`${t.duration_minutes} minutes. ${t.auto_approve ? 'Confirmed right away.' : 'You confirm each request.'}`}
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={`Edit ${t.name}`} style={[styles.secondary, { borderColor: colors.textPrimary }]} testID={`coach-type-edit-${t.id}`}>
              <Text style={[typography.body, { color: colors.textPrimary }]}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => setArchived(t, !t.archived_at)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t.archived_at ? `Restore ${t.name}` : `Archive ${t.name}`}
              style={[styles.secondary, { borderColor: colors.textPrimary }]}
              testID={`coach-type-archive-${t.id}`}
            >
              <Text style={[typography.body, { color: colors.textPrimary }]}>{t.archived_at ? 'Restore' : 'Archive'}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {archivedHere.length ? <Text style={[typography.bodySmall, { color: colors.textMuted }]}>Types archived during this visit can be restored here until you leave this screen.</Text> : null}
      {!editing && error ? <Text accessibilityLiveRegion="polite" style={[typography.bodySmall, { color: colors.error }]}>{error}</Text> : null}

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!busy) setEditing(null); }}>
        <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container} testID="coach-type-editor">
          <Text style={[typography.h2, { color: colors.textPrimary }]} accessibilityRole="header">
            {editing === 'new' ? 'New appointment type' : 'Edit appointment type'}
          </Text>
          <Text style={[styles.label, { color: colors.textMuted }]}>Name</Text>
          <TextInput value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} maxLength={120} accessibilityLabel="Name" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} testID="coach-type-name" />
          <Text style={[styles.label, { color: colors.textMuted }]}>Description (optional)</Text>
          <TextInput value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} maxLength={2000} multiline accessibilityLabel="Description" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, minHeight: 72 }]} />
          <Text style={[styles.label, { color: colors.textMuted }]}>Length in minutes</Text>
          <View style={styles.chips}>
            {DURATIONS.map((m) => (
              <Pressable key={m} onPress={() => setDraft({ ...draft, duration: String(m) })} accessibilityRole="button" accessibilityState={{ selected: draft.duration === String(m) }} accessibilityLabel={`${m} minutes`} style={[styles.chip, { borderColor: colors.textPrimary, backgroundColor: draft.duration === String(m) ? colors.textPrimary : 'transparent' }]}>
                <Text style={[typography.body, { color: draft.duration === String(m) ? colors.background : colors.textPrimary }]}>{m}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={draft.duration} onChangeText={(duration) => setDraft({ ...draft, duration: duration.replace(/[^0-9]/g, '') })} keyboardType="number-pad" maxLength={3} accessibilityLabel="Length in minutes" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} testID="coach-type-duration" />
          <View style={styles.switchRow}>
            <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>Confirm right away (no approval)</Text>
            <Switch value={draft.autoApprove} onValueChange={(autoApprove) => setDraft({ ...draft, autoApprove })} accessibilityLabel="Confirm right away" testID="coach-type-auto" />
          </View>
          {error ? <Text style={[typography.bodySmall, { color: colors.error, marginTop: spacing.md }]} testID="coach-type-error" accessibilityLiveRegion="polite">{error}</Text> : null}
          <Pressable onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled: busy, busy }} style={[styles.primary, { backgroundColor: colors.textPrimary, opacity: busy ? 0.6 : 1 }]} testID="coach-type-save">
            <Text style={[typography.bodyMd, { color: colors.background }]}>Save</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(null)} disabled={busy} accessibilityRole="button" accessibilityLabel="Close" style={[styles.secondary, { borderColor: colors.textPrimary, marginTop: spacing.md }]}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>Close</Text>
          </Pressable>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, padding: spacing.md, marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  secondary: { flex: 1, minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.caption, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, padding: spacing.md, ...typography.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { minWidth: 56, minHeight: 40, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.md },
});
