/**
 * CoachAppointmentTypesScreen — S-SCHED appointment types manager.
 *
 * Create, edit and archive the appointment types clients book from: name,
 * description, length, confirmed right away (auto-approve), welcome call
 * marker and an optional default meeting link that is attached when a
 * session of this type is confirmed. Archived types stay listed (and can
 * be restored) but clients no longer see them. Only one active type can be
 * the welcome call; the server clears the marker on the others.
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
import { useCoachTypesIncludingArchived } from '../../hooks/useCalendar';
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
  isWelcome: boolean;
  meetingUrl: string;
}

export function emptyDraft(): TypeDraft {
  return { name: '', description: '', duration: '30', autoApprove: false, isWelcome: false, meetingUrl: '' };
}

export function draftFrom(t: SessionType): TypeDraft {
  return {
    name: t.name,
    description: t.description ?? '',
    duration: String(t.duration_minutes),
    autoApprove: t.auto_approve,
    isWelcome: !!t.is_welcome,
    meetingUrl: t.default_meeting_url ?? '',
  };
}

/** Returns an error message, or null when the draft can be saved. */
export function validateDraft(d: TypeDraft): string | null {
  if (d.name.trim().length === 0) return 'Give the appointment type a name.';
  if (d.name.trim().length > 120) return 'Keep the name under 120 characters.';
  const n = Number(d.duration);
  if (!Number.isInteger(n) || n < 5 || n > 480) return 'Length must be between 5 and 480 minutes.';
  const url = d.meetingUrl.trim();
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) return 'The meeting link must start with https://';
  if (url.length > 500) return 'The meeting link is too long.';
  return null;
}

export default function CoachAppointmentTypesScreen({ route }: { route?: RouteProp<Params, 'CoachAppointmentTypes'> }) {
  const { colors } = useTheme();
  const me = useCurrentUser();
  const coachId = route?.params?.coachId ?? me?.id;
  const q = useCoachTypesIncludingArchived(coachId);
  const create = useCreateSessionType();
  const update = useUpdateSessionType();
  const [editing, setEditing] = useState<SessionType | 'new' | null>(null);
  const [draft, setDraft] = useState<TypeDraft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
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
    const url = draft.meetingUrl.trim();
    const common = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      duration_minutes: Number(draft.duration),
      auto_approve: draft.autoApprove,
      is_welcome: draft.isWelcome,
    };
    const done = {
      onSuccess: () => setEditing(null),
      onError: () => setError('That did not save. Check your connection and try again.'),
      onSettled: () => {
        saving.current = false;
      },
    };
    if (editing === 'new') {
      create.mutate(
        { ...common, default_video_provider: 'manual', ...(url ? { default_meeting_url: url } : {}) },
        done,
      );
    } else {
      update.mutate({ id: editing.id, input: { ...common, default_meeting_url: url || null } }, done);
    }
  };

  const setArchived = (t: SessionType, archived: boolean) => {
    update.mutate({ id: t.id, input: { archived } });
  };

  const rows = [...(q.data ?? [])].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at));
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
        <Text style={[typography.body, { color: colors.textMuted }]}>Could not load. Pull back and try again.</Text>
      ) : null}
      {!q.isLoading && rows.length === 0 ? (
        <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.lg }]} testID="coach-types-empty">
          No appointment types yet. Clients cannot book until you add one.
        </Text>
      ) : null}
      {rows.map((t) => (
        <View key={t.id} style={[styles.card, { borderColor: colors.border, opacity: t.archived_at ? 0.6 : 1 }]} testID={`coach-type-${t.id}`}>
          <Text style={[typography.bodyMd, { color: colors.textPrimary }]}>
            {t.name}
            {t.is_welcome ? ' (welcome call)' : ''}
            {t.archived_at ? ' (archived)' : ''}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textMuted }]}>
            {`${t.duration_minutes} minutes. ${t.auto_approve ? 'Confirmed right away.' : 'You confirm each request.'}${t.default_meeting_url ? ' Has a meeting link.' : ''}`}
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

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
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
          <View style={styles.switchRow}>
            <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>Welcome call (offered at the end of the client tour)</Text>
            <Switch value={draft.isWelcome} onValueChange={(isWelcome) => setDraft({ ...draft, isWelcome })} accessibilityLabel="Welcome call" testID="coach-type-welcome" />
          </View>
          <Text style={[styles.label, { color: colors.textMuted }]}>Default meeting link (optional, https)</Text>
          <TextInput value={draft.meetingUrl} onChangeText={(meetingUrl) => setDraft({ ...draft, meetingUrl })} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={500} accessibilityLabel="Default meeting link" style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} testID="coach-type-url" />
          <Text style={[typography.bodySmall, { color: colors.textMuted }]}>
            Attached to each confirmed session of this type that has no link yet. You can still set a different link on one session.
          </Text>
          {error ? <Text style={[typography.bodySmall, { color: colors.error, marginTop: spacing.md }]} testID="coach-type-error" accessibilityLiveRegion="polite">{error}</Text> : null}
          <Pressable onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled: busy, busy }} style={[styles.primary, { backgroundColor: colors.textPrimary, opacity: busy ? 0.6 : 1 }]} testID="coach-type-save">
            <Text style={[typography.bodyMd, { color: colors.background }]}>Save</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(null)} accessibilityRole="button" accessibilityLabel="Close" style={[styles.secondary, { borderColor: colors.textPrimary, marginTop: spacing.md }]}>
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
